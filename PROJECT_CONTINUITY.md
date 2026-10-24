# MotionWren — project continuity

Last reconciled: October 23, 2026

## Client workflow release — October 23, 2026

The public home page is now the minimal client intake experience. The owner dashboard is at `/dashboard`, and the advanced generation workspace is at `/studio`; both owner routes require the signed-in studio-owner account. Client submissions are stored in D1, source photos are stored in R2, and each dashboard project can be downloaded as one ZIP with an organized project brief.

This document prevents decisions made in separate ChatGPT accounts from being
mistaken for implemented product features.

## Source of truth

- Product: MotionWren — Private
- Production URL: https://motionwren-private-studio.reda-photoemail.chatgpt.site
- Sites project ID: `appgprj_6aa25db31d9081918f703f05eaf43abd`
- Current codebase: this repository
- Current production architecture: a private web studio using cloud video
  models, with scene-level controls, real-estate prompts, price estimates,
  history, individual clip generation and multi-shot stitching.

## Implemented in the current studio

- Single-shot image-to-video generation
- Multi-shot property-film workflow
- Drag ordering and individual scene direction
- Three-second controlled scenes
- 20-, 35- and 50-second planning choices with 5-, 10- and 15-photo allowances
- Automatic stitching into one downloadable film
- Real-estate camera lock and property-preservation prompt
- Landscape, vertical and crop-safe formats
- Multiple engines, including WAN, Seedance, Runway, MiniMax, Gemini and Kling
- Engine-specific resolution and price estimates
- Opening property information and closing agent-card options
- Music, voiceover, history and upscaling controls
- Classic listing, vertical social and luxury cinematic recipes

## Decisions recovered from the separate phone conversation

The separate conversation was planning and research only. It did not edit,
deploy or synchronize with this repository.

Its recommended future architecture was a hybrid renderer:

1. Use deterministic 2D movement and FFmpeg for the safest property shots.
2. Test restrained 2.5D depth animation using Depth Anything and DepthFlow.
3. Use paid generative models only for selected hero shots that need more
   movement.
4. Automatically inspect generated clips for warped walls, changed windows,
   object movement, softness and temporal artifacts.
5. Measure cost per approved shot, not merely cost per generation.
6. Keep local processing on a Mac mini M1/16 GB where practical, with cloud
   generation used on demand.

The proposed production modes were:

- **Accurate Tour:** deterministic 2D movement and restrained depth animation.
- **Cinematic Tour:** mostly deterministic clips with selected AI hero shots.
- **Creative Showcase:** more generative movement with manual review.

The conversation also proposed testing direct model-provider APIs—especially
MiniMax H3, WAN 3.0 and Gemini Omni—rather than relying permanently on a
consumer real-estate-video subscription. BetterSpace's announced Space model
was identified as a model/API-access inquiry, not an available integration.

## Not implemented yet

Do not describe any of the following as working product features:

- Local FFmpeg animation pipeline
- Depth Anything or DepthFlow integration
- Automated architectural-artifact detection
- Automatic routing between local and generative rendering
- Accurate Tour, Cinematic Tour and Creative Showcase as operational modes
- Direct MiniMax, Alibaba, Google or BetterSpace model-provider connections
- BetterSpace Space API integration
- A Mac mini rendering worker

## BetterSpace inquiry status

A message asking BetterSpace about direct Space API access was drafted in the
phone conversation. No verified recipient address was found, and the inquiry
was not shown as successfully sent. Treat this as an open task, not completed
external communication.

## Reconciled direction

The existing private studio should be preserved. The hybrid renderer is a
future extension, not a replacement that has already been built. The safest
implementation sequence is:

1. Preserve and stabilize the existing property-film workflow.
2. Add deterministic FFmpeg movement as an additional engine.
3. Test depth animation on representative interiors and exteriors.
4. Build automated quality checks and scene-level fallback.
5. Add customer-facing presets that hide technical engine selection.
6. Promote a model or renderer only after it passes property-fidelity tests.

Any future agent should confirm current production state before changing this
roadmap and should never overwrite the private studio on the assumption that
the phone-chat proposal was already implemented.
