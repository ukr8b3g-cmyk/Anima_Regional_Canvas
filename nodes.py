import base64
import io
import json
import numpy as np
import torch
from PIL import Image


MAX_RESOLUTION = 16384
REGIONS = (
    ("red", "RED", (1.0, 0.0, 0.0)),
    ("blue", "BLUE", (0.0, 0.0, 1.0)),
    ("yellow", "YELLOW", (1.0, 1.0, 0.0)),
    ("green", "GREEN", (0.0, 1.0, 0.0)),
    ("magenta", "MAGENTA", (1.0, 0.0, 1.0)),
)
STANDARD_PROMPT_DEFAULTS = {
    "quality_prompt": "masterpiece, absurdres, score_7, anime style",
    "scene_prompt": "",
    "red_prompt": "",
    "blue_prompt": "",
    "yellow_prompt": "",
    "green_prompt": "",
    "magenta_prompt": "",
    "negative_prompt": "worst quality, low quality, blurry, bad anatomy",
}

def _text_input(default=""):
    return ("STRING", {"multiline": True, "dynamicPrompts": True, "default": default})


def _canvas_input():
    return ("STRING", {"multiline": True, "default": ""})


def _encode_text(clip, text):
    if clip is None:
        raise RuntimeError("CLIP input is required.")
    tokens = clip.tokenize(text or "")
    if hasattr(clip, "encode_from_tokens_scheduled"):
        return clip.encode_from_tokens_scheduled(tokens)

    if hasattr(clip, "encode_from_tokens"):
        try:
            encoded = clip.encode_from_tokens(tokens, return_pooled=True)
        except TypeError:
            encoded = clip.encode_from_tokens(tokens)
        if isinstance(encoded, tuple):
            cond = encoded[0]
            pooled = encoded[1] if len(encoded) > 1 else None
            meta = {"pooled_output": pooled} if pooled is not None else {}
            return [[cond, meta]]
        return [[encoded, {}]]

    raise RuntimeError("CLIP object does not support token encoding.")


def _intermediate_device():
    try:
        import comfy.model_management as model_management

        return model_management.intermediate_device()
    except Exception:
        return torch.device("cpu")


def _intermediate_dtype():
    try:
        import comfy.model_management as model_management

        return model_management.intermediate_dtype()
    except Exception:
        return torch.float32


def _conditioning_set_values(conditioning, values):
    updated = []
    for item in conditioning:
        entry = [item[0], item[1].copy()]
        for key, value in values.items():
            entry[1][key] = value
        updated.append(entry)
    return updated


def _nearest_resample():
    resampling = getattr(Image, "Resampling", None)
    return getattr(resampling, "NEAREST", Image.NEAREST)


def _set_mask(conditioning, mask, strength, set_area_to_bounds=False):
    if len(mask.shape) < 3:
        mask = mask.unsqueeze(0)
    return _conditioning_set_values(
        conditioning,
        {
            "mask": mask,
            "set_area_to_bounds": set_area_to_bounds,
            "mask_strength": strength,
        },
    )


def _set_default(conditioning):
    return _conditioning_set_values(conditioning, {"default": True})


def _latent(width, height, batch_size):
    width, height = _latent_size(width, height)
    samples = torch.zeros(
        [batch_size, 4, height // 8, width // 8],
        device=_intermediate_device(),
        dtype=_intermediate_dtype(),
    )
    return {"samples": samples, "downscale_ratio_spacial": 8}


def _latent_size(width, height):
    width = min(MAX_RESOLUTION, max(16, int(width))) // 8 * 8
    height = min(MAX_RESOLUTION, max(16, int(height))) // 8 * 8
    return width, height


def _resize_image_tensor(image, width, height):
    width, height = _latent_size(width, height)
    src = image[:, :, :, :3].float()
    if src.shape[1:3] == (height, width):
        return src
    return torch.nn.functional.interpolate(
        src.movedim(-1, 1),
        size=(height, width),
        mode="bilinear",
        align_corners=False,
    ).movedim(1, -1)


def _grow_mask(mask, amount):
    mask = mask.reshape((-1, 1, mask.shape[-2], mask.shape[-1]))
    amount = max(0, int(amount))
    if amount <= 0:
        return mask.round()
    mask = mask.round()
    kernel_size = amount * 2 + 1
    return torch.nn.functional.max_pool2d(mask, kernel_size, stride=1, padding=amount)


def _inpaint_latent(vae, pixels, mask, grow_mask_by):
    downscale_ratio = vae.spacial_compression_encode() if hasattr(vae, "spacial_compression_encode") else 8
    height = (pixels.shape[1] // downscale_ratio) * downscale_ratio
    width = (pixels.shape[2] // downscale_ratio) * downscale_ratio
    mask = torch.nn.functional.interpolate(
        mask.reshape((-1, 1, mask.shape[-2], mask.shape[-1])),
        size=(pixels.shape[1], pixels.shape[2]),
        mode="bilinear",
    )
    pixels = pixels.clone()
    if pixels.shape[1] != height or pixels.shape[2] != width:
        y_offset = (pixels.shape[1] % downscale_ratio) // 2
        x_offset = (pixels.shape[2] % downscale_ratio) // 2
        pixels = pixels[:, y_offset:height + y_offset, x_offset:width + x_offset, :]
        mask = mask[:, :, y_offset:height + y_offset, x_offset:width + x_offset]

    noise_mask = _grow_mask(mask, grow_mask_by)[:, :, :height, :width].round()
    keep = (1.0 - mask.round()).squeeze(1)
    for channel in range(3):
        pixels[:, :, :, channel] -= 0.5
        pixels[:, :, :, channel] *= keep
        pixels[:, :, :, channel] += 0.5

    return {"samples": vae.encode(pixels), "noise_mask": noise_mask}


def _image_from_canvas(canvas_data, width, height, batch_size):
    width, height = _latent_size(width, height)
    image = None
    if canvas_data:
        try:
            payload = json.loads(canvas_data)
            data_url = payload.get("data_url", "")
            if "," in data_url:
                data_url = data_url.split(",", 1)[1]
            raw = base64.b64decode(data_url)
            image = Image.open(io.BytesIO(raw)).convert("RGB")
        except Exception:
            image = None

    if image is None:
        image = Image.new("RGB", (width, height), (255, 255, 255))
    elif image.size != (width, height):
        image = image.resize((width, height), _nearest_resample())

    arr = np.asarray(image, dtype=np.float32) / 255.0
    tensor = torch.from_numpy(arr).unsqueeze(0).to(
        device=_intermediate_device(),
        dtype=_intermediate_dtype(),
    )
    if batch_size > 1:
        tensor = tensor.repeat(batch_size, 1, 1, 1)
    return tensor


def _mask_preview_image(mask_image, base_image=None, alpha=0.45):
    mask = mask_image[:, :, :, :3].float()
    if base_image is None:
        base = torch.ones_like(mask)
    else:
        base = base_image[:, :, :, :3].float()
        if base.shape[1:3] != mask.shape[1:3]:
            base = torch.nn.functional.interpolate(
                base.movedim(-1, 1),
                size=mask.shape[1:3],
                mode="bilinear",
                align_corners=False,
            ).movedim(1, -1)
        if base.shape[0] != mask.shape[0]:
            base = base[:1].repeat(mask.shape[0], 1, 1, 1)
    painted = (mask < 0.98).any(dim=-1, keepdim=True).float()
    return torch.clamp(base * (1.0 - painted * alpha) + mask * (painted * alpha), 0.0, 1.0)


def _extract_masks(image, threshold=0.15):
    src = image[0].detach()
    r, g, b = src[..., 0], src[..., 1], src[..., 2]
    masks = {
        "red": ((r >= 1 - threshold) & (g < threshold) & (b < threshold)).float(),
        "blue": ((r < threshold) & (g < threshold) & (b >= 1 - threshold)).float(),
        "yellow": ((r >= 1 - threshold) & (g >= 1 - threshold) & (b < threshold)).float(),
        "green": ((r < threshold) & (g >= 1 - threshold) & (b < threshold)).float(),
        "magenta": ((r >= 1 - threshold) & (g < threshold) & (b >= 1 - threshold)).float(),
        "white": ((r >= 1 - threshold) & (g >= 1 - threshold) & (b >= 1 - threshold)).float(),
    }
    union = torch.zeros_like(masks["white"])
    for key, _, _ in REGIONS:
        union = torch.maximum(union, masks[key])
    masks["base"] = torch.clamp(1.0 - union, 0.0, 1.0)
    return masks


def _prompts(kwargs):
    legacy_base = kwargs.get("base_prompt_in") or kwargs.get("base_prompt") or ""
    result = {
        "quality": kwargs.get("quality_prompt_in") or kwargs.get("quality_prompt") or legacy_base,
        "scene": kwargs.get("scene_prompt_in") or kwargs.get("scene_prompt") or "",
        "negative": kwargs.get("negative_prompt_in") or kwargs.get("negative_prompt") or "",
    }
    for key, label, _ in REGIONS:
        result[key] = kwargs.get(f"{key}_prompt_in") or kwargs.get(f"{key}_prompt") or ""
    return result


def _positive_prompt_text(prompts):
    return "\n\n".join(
        text.strip()
        for text in [prompts["quality"], prompts["scene"], *(prompts[key] for key, _, _ in REGIONS)]
        if text and text.strip()
    )


def _global_prompt_text(prompts):
    return "\n\n".join(
        text.strip()
        for text in [prompts["quality"], prompts["scene"]]
        if text and text.strip()
    )


def _region_prompt_text(prompts, key):
    return "\n\n".join(
        text.strip()
        for text in [prompts["quality"], prompts["scene"], prompts[key]]
        if text and text.strip()
    )


def _conditioning(clip, prompts, masks, strength, enabled=True):
    global_text = _global_prompt_text(prompts) or _positive_prompt_text(prompts)

    if not enabled:
        positive = _encode_text(clip, _positive_prompt_text(prompts) or global_text)
        negative = _encode_text(clip, prompts["negative"])
        return positive, negative

    positive = _set_default(_encode_text(clip, global_text))
    active_regions = 0
    for key, _, _ in REGIONS:
        text = prompts[key].strip()
        if not text:
            continue
        mask = masks.get(key)
        if mask is None or torch.max(mask).item() <= 0:
            continue
        positive.extend(_set_mask(_encode_text(clip, _region_prompt_text(prompts, key)), mask, strength, False))
        active_regions += 1

    if active_regions == 0:
        positive = _encode_text(clip, global_text)

    negative = _encode_text(clip, prompts["negative"])
    return positive, negative


def _metadata(prompts, width, height, mode, regional_enabled, region_strength):
    return json.dumps(
        {
            "node": "Anima Regional Canvas",
            "mode": mode,
            "width": width,
            "height": height,
            "regional_enabled": bool(regional_enabled),
            "region_strength": float(region_strength),
            "regions": {label: prompts[key] for key, label, _ in REGIONS},
            "prompt": _positive_prompt_text(prompts),
            "quality": prompts["quality"],
            "scene": prompts["scene"],
            "base": _global_prompt_text(prompts),
            "negative": prompts["negative"],
        },
        ensure_ascii=False,
    )


class AnimaRegionalCanvas:
    @classmethod
    def INPUT_TYPES(cls):
        required = {
            "model": ("MODEL",),
            "clip": ("CLIP",),
            "width": ("INT", {"default": 1024, "min": 16, "max": MAX_RESOLUTION, "step": 8}),
            "height": ("INT", {"default": 1024, "min": 16, "max": MAX_RESOLUTION, "step": 8}),
            "batch_size": ("INT", {"default": 1, "min": 1, "max": 4096}),
            "brush_size": ("INT", {"default": 92, "min": 1, "max": 512, "step": 1}),
            "region_strength": ("FLOAT", {"default": 0.95, "min": 0.0, "max": 10.0, "step": 0.01}),
            "quality_prompt": _text_input(STANDARD_PROMPT_DEFAULTS["quality_prompt"]),
            "scene_prompt": _text_input(STANDARD_PROMPT_DEFAULTS["scene_prompt"]),
            "red_prompt": _text_input(STANDARD_PROMPT_DEFAULTS["red_prompt"]),
            "blue_prompt": _text_input(STANDARD_PROMPT_DEFAULTS["blue_prompt"]),
            "yellow_prompt": _text_input(STANDARD_PROMPT_DEFAULTS["yellow_prompt"]),
            "green_prompt": _text_input(STANDARD_PROMPT_DEFAULTS["green_prompt"]),
            "magenta_prompt": _text_input(STANDARD_PROMPT_DEFAULTS["magenta_prompt"]),
            "negative_prompt": _text_input(STANDARD_PROMPT_DEFAULTS["negative_prompt"]),
            "canvas_data": _canvas_input(),
            "regional_enabled": ("BOOLEAN", {"default": True}),
        }
        optional = {
            "quality_prompt_in": ("STRING", {"forceInput": True}),
            "scene_prompt_in": ("STRING", {"forceInput": True}),
            "red_prompt_in": ("STRING", {"forceInput": True}),
            "blue_prompt_in": ("STRING", {"forceInput": True}),
            "yellow_prompt_in": ("STRING", {"forceInput": True}),
            "green_prompt_in": ("STRING", {"forceInput": True}),
            "magenta_prompt_in": ("STRING", {"forceInput": True}),
            "negative_prompt_in": ("STRING", {"forceInput": True}),
        }
        return {"required": required, "optional": optional}

    RETURN_TYPES = ("IMAGE", "MODEL", "CONDITIONING", "CONDITIONING", "LATENT", "STRING", "IMAGE")
    RETURN_NAMES = ("IMAGE", "MODEL", "POSITIVE", "NEGATIVE", "LATENT", "METADATA", "MASK_PREVIEW")
    FUNCTION = "execute"
    CATEGORY = "Anima/Regional"

    def execute(self, model, clip, width, height, batch_size, brush_size, region_strength, canvas_data="", **kwargs):
        width, height = _latent_size(width, height)
        batch_size = max(1, int(batch_size))
        image = _image_from_canvas(canvas_data, width, height, batch_size)
        masks = _extract_masks(image)
        prompts = _prompts(kwargs)
        regional_enabled = kwargs.get("regional_enabled", True)
        positive, negative = _conditioning(clip, prompts, masks, region_strength, regional_enabled)
        latent = _latent(width, height, batch_size)
        metadata = _metadata(prompts, width, height, "standard", regional_enabled, region_strength)
        preview = _mask_preview_image(image)
        return (image, model, positive, negative, latent, metadata, preview)

class AnimaRegionalInpaintCanvas:
    @classmethod
    def INPUT_TYPES(cls):
        required = {
            "model": ("MODEL",),
            "clip": ("CLIP",),
            "width": ("INT", {"default": 1024, "min": 16, "max": MAX_RESOLUTION, "step": 8}),
            "height": ("INT", {"default": 1024, "min": 16, "max": MAX_RESOLUTION, "step": 8}),
            "batch_size": ("INT", {"default": 1, "min": 1, "max": 4096}),
            "brush_size": ("INT", {"default": 92, "min": 1, "max": 512, "step": 1}),
            "region_strength": ("FLOAT", {"default": 0.95, "min": 0.0, "max": 10.0, "step": 0.01}),
            "quality_prompt": _text_input(STANDARD_PROMPT_DEFAULTS["quality_prompt"]),
            "scene_prompt": _text_input(STANDARD_PROMPT_DEFAULTS["scene_prompt"]),
            "red_prompt": _text_input(STANDARD_PROMPT_DEFAULTS["red_prompt"]),
            "blue_prompt": _text_input(STANDARD_PROMPT_DEFAULTS["blue_prompt"]),
            "yellow_prompt": _text_input(STANDARD_PROMPT_DEFAULTS["yellow_prompt"]),
            "green_prompt": _text_input(STANDARD_PROMPT_DEFAULTS["green_prompt"]),
            "magenta_prompt": _text_input(STANDARD_PROMPT_DEFAULTS["magenta_prompt"]),
            "negative_prompt": _text_input(STANDARD_PROMPT_DEFAULTS["negative_prompt"]),
            "canvas_data": _canvas_input(),
            "regional_enabled": ("BOOLEAN", {"default": True}),
            "grow_mask_by": ("INT", {"default": 6, "min": 0, "max": 64, "step": 1}),
        }
        optional = {
            "vae": ("VAE",),
            "quality_prompt_in": ("STRING", {"forceInput": True}),
            "scene_prompt_in": ("STRING", {"forceInput": True}),
            "red_prompt_in": ("STRING", {"forceInput": True}),
            "blue_prompt_in": ("STRING", {"forceInput": True}),
            "yellow_prompt_in": ("STRING", {"forceInput": True}),
            "green_prompt_in": ("STRING", {"forceInput": True}),
            "magenta_prompt_in": ("STRING", {"forceInput": True}),
            "negative_prompt_in": ("STRING", {"forceInput": True}),
            "image": ("IMAGE",),
        }
        return {"required": required, "optional": optional}

    RETURN_TYPES = ("IMAGE", "MODEL", "CONDITIONING", "CONDITIONING", "LATENT", "MASK", "STRING")
    RETURN_NAMES = ("IMAGE", "MODEL", "POSITIVE", "NEGATIVE", "INPAINT_LATENT", "INPAINT_MASK", "METADATA")
    FUNCTION = "execute"
    CATEGORY = "Anima/Regional"

    def execute(self, model, clip, width, height, batch_size, brush_size, region_strength, grow_mask_by, canvas_data="", **kwargs):
        width, height = _latent_size(width, height)
        batch_size = max(1, int(batch_size))
        mask_image = _image_from_canvas(canvas_data, width, height, batch_size)
        masks = _extract_masks(mask_image)
        prompts = _prompts(kwargs)
        regional_enabled = kwargs.get("regional_enabled", True)
        positive, negative = _conditioning(clip, prompts, masks, region_strength, regional_enabled)
        inpaint_mask = torch.clamp(1.0 - masks["base"], 0.0, 1.0)
        inpaint_mask = inpaint_mask.unsqueeze(0).repeat(batch_size, 1, 1)
        source_image = kwargs.get("image")
        vae = kwargs.get("vae")
        if source_image is not None and vae is not None:
            pixels = _resize_image_tensor(source_image, width, height)
            if pixels.shape[0] != batch_size:
                pixels = pixels[:1].repeat(batch_size, 1, 1, 1)
            latent = _inpaint_latent(vae, pixels, inpaint_mask, grow_mask_by)
        else:
            latent = _latent(width, height, batch_size)
        metadata = _metadata(prompts, width, height, "inpaint", regional_enabled, region_strength)
        return (mask_image, model, positive, negative, latent, inpaint_mask, metadata)

NODE_CLASS_MAPPINGS = {
    "AnimaRegionalCanvas": AnimaRegionalCanvas,
    "AnimaRegionalInpaintCanvas": AnimaRegionalInpaintCanvas,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AnimaRegionalCanvas": "Anima Regional Canvas",
    "AnimaRegionalInpaintCanvas": "Anima Regional Inpaint Canvas",
}
