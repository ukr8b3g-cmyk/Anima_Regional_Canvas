# Anima Regional Canvas
<img width="1712" height="745" alt="Clip_7" src="https://github.com/user-attachments/assets/73c40c9b-d6b1-4eab-a3e7-0baf36a4f8af" />



An ANIMA-focused custom node for Anima-LLLite Regional ControlNet workflows.

It is designed for ANIMA workflows using the Anima base model, Anima-LLLite, and the Anima-LLLite Regional ControlNet model. The node lets you paint color-coded regions directly inside ComfyUI, outputs the color mask image for `Apply Anima ControlNet-LLLite`, and generates masked conditioning from matching region prompts.

## Requirements

- Node: [kohya-ss/ComfyUI-Anima-LLLite](https://github.com/kohya-ss/ComfyUI-Anima-LLLite)
- Recommended base model: [circlestone-labs/Anima](https://huggingface.co/circlestone-labs/Anima)
- Model: [anima-lllite-regional-exp-v3.safetensors](https://huggingface.co/Sen-sou/Anima-LLLite-Regional-Controlnet/resolve/main/anima-lllite-regional-exp-v3.safetensors)
- Model repository: [Sen-sou/Anima-LLLite-Regional-Controlnet](https://huggingface.co/Sen-sou/Anima-LLLite-Regional-Controlnet)

## Install

Clone this repository into ComfyUI's `custom_nodes` folder:

```powershell
cd D:\Codex\ComfyUI\custom_nodes
git clone https://github.com/ukr8b3g-cmyk/Anima_Regional_Canvas.git
```

Restart ComfyUI after installation.

This node does not include the Anima-LLLite node or the regional ControlNet model. Install them separately:

- [kohya-ss/ComfyUI-Anima-LLLite](https://github.com/kohya-ss/ComfyUI-Anima-LLLite)
- Recommended base model: [circlestone-labs/Anima](https://huggingface.co/circlestone-labs/Anima)
- [anima-lllite-regional-exp-v3.safetensors](https://huggingface.co/Sen-sou/Anima-LLLite-Regional-Controlnet/resolve/main/anima-lllite-regional-exp-v3.safetensors)

## Design

- `Apply Anima ControlNet-LLLite` stays separate.
- `KSampler`, `VAE Decode`, and `Save WEBP Meta` stay separate.
- External custom nodes are not imported or called.
- This implementation is independently designed, inspired by regional conditioning workflows, and optimized for this canvas-based node. It does not reuse external custom-node code.
- Regional control uses ComfyUI's standard masked conditioning: only painted colors with non-empty prompts are encoded.
- `QUALITY` is for quality/style tags.
- `SCENE` is for count, subject names, background, and situation, for example `2girls, cirno, reimu, cafe`.
- `RED`, `BLUE`, `YELLOW`, `GREEN`, and `MAGENTA` are region prompts.

## Outputs

- `IMAGE`: color mask image for `Apply Anima ControlNet-LLLite image`
- `MODEL`: passthrough model
- `POSITIVE`: masked conditioning for `KSampler positive`
- `NEGATIVE`: conditioning for `KSampler negative`
- `LATENT`: empty latent using the canvas size
- `METADATA`: prompt metadata string
- `MASK_PREVIEW`: preview-only image

## Compatibility

Verified in this workspace:

- Python `3.13.11`
- PyTorch `2.12.1+cu130`
- CUDA build `13.0`
- Pillow `12.2.0`
- NumPy `2.4.4`

Inferred minimum:

- Python: ComfyUI-supported Python, practically `3.10+`.
- PyTorch: ComfyUI-supported PyTorch. This node uses only basic tensor ops and should not require a specific CUDA build.
- CUDA: no direct dependency. CPU or any CUDA build that your ComfyUI/PyTorch already supports is acceptable.
- Pillow/NumPy: no special version pin; ComfyUI's installed versions are sufficient.

The node avoids hard version pins and only lazily uses ComfyUI core helpers when available.

## Standard Connection

```text
Anima Regional Canvas IMAGE -> Apply Anima ControlNet-LLLite image
Apply Anima ControlNet-LLLite MODEL -> KSampler model
Anima Regional Canvas POSITIVE -> KSampler positive
Anima Regional Canvas NEGATIVE -> KSampler negative
Anima Regional Canvas LATENT -> KSampler latent_image
KSampler LATENT -> VAE Decode -> Save WEBP Meta
```

## Connection Chart

```mermaid
flowchart LR
  Model["Load Diffusion Model"] --> Canvas["Anima Regional Canvas"]
  Clip["Load CLIP"] --> Canvas
  VAE["Load VAE"] --> Decode["VAE Decode"]
  Canvas -- IMAGE --> LLLite["Apply Anima ControlNet-LLLite"]
  Canvas -- MODEL --> LLLite
  LLLite -- MODEL --> KSampler
  Canvas -- POSITIVE --> KSampler
  Canvas -- NEGATIVE --> KSampler
  Canvas -- LATENT --> KSampler
  KSampler -- LATENT --> Decode
  Decode -- IMAGE --> Save["Save WEBP Meta"]
  Canvas -- MASK_PREVIEW --> Preview["Preview Image optional"]
```

## UI Prompt Fields

- `QUALITY`: quality and style tags, for example `masterpiece, absurdres, score_7, anime style`.
- `SCENE`: count, subject names, background, and situation, for example `2girls, cirno, reimu, cafe`.
- `RED` / `BLUE` / `YELLOW` / `GREEN` / `MAGENTA`: prompt for each painted region.
- `NEGATIVE`: negative prompt.

## Colors

- `RED`
- `BLUE`
- `YELLOW`
- `GREEN`
- `MAGENTA`
- white background uses the default `QUALITY` + `SCENE` conditioning

## Acknowledgements

- [kohya-ss/ComfyUI-Anima-LLLite](https://github.com/kohya-ss/ComfyUI-Anima-LLLite) for the Anima-LLLite ComfyUI node.
- [Sen-sou/Anima-LLLite-Regional-Controlnet](https://huggingface.co/Sen-sou/Anima-LLLite-Regional-Controlnet) for the regional ControlNet model.
- ComfyUI and its community.

## License

MIT License. See [LICENSE](LICENSE).
