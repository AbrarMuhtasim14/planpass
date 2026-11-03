# **Product Requirements Document (PRD): PlanPass**

**Product Name:** PlanPass — AI Municipal Blueprint & Code Compliance Examiner  
**Document Version:** 2.0 (Comprehensive Product & Engineering PRD)  
**Target Release:** Meta Global AI Developer Hackathon MVP (November 4, 2026\)  
**Category:** GovTech / AEC (Architecture, Engineering & Construction) / AI Agentic Workflow

* # **1\. Product Overview & Vision**

## **1.1 Product Summary**

PlanPass is an AI-powered architectural plan-review and pre-permitting platform designed for municipal building departments, architectural firms, general contractors, and permitting expediters. By combining computer vision segmentation, spatial reasoning, statutory building-code retrieval, and generative blueprint redlining, PlanPass automates the compliance review of 2D architectural floorplans against the International Building Code (IBC), NFPA 101 Life Safety Code, and ADA Standards for Accessible Design.

## **1.2 Vision Statement**

To eliminate multi-month municipal permitting backlogs by turning any entry-level permitting clerk, junior technician, or contractor into a certified-grade building code examiner—compressing a 16-week manual plan rejection cycle into a 30-second interactive pre-check and visual remediation workflow.

# **2\. Problem Statement & Market Opportunity**

## **2.1 The Core Problem**

* **Severe Municipal Bottlenecks:** City building departments across the United States take 8 to 24 weeks to review residential and commercial floorplans due to a shortage of licensed plan examiners.  
* **High First-Time Rejection Rates:** Over 65% of submitted architectural plans fail their initial municipal review due to recurring spatial and accessibility errors (such as inward-swinging restroom doors violating 60-inch wheelchair turning circles, narrow egress corridors, or improper door leaf clearances).  
* **Fragmented, Manual Workflows:** Reviewers manually cross-reference static PDF/CAD sheets against thousands of pages of IBC, ADA, and local municipal amendments, manually drawing redlines and typing correction comments.  
* **High Cost of Specialist Labor:** Small contractors and property owners cannot afford \$250/hour code consultants for pre-submission checks, while junior \$15/hour clerks lack the statutory expertise to spot code violations without AI augmentation.

## **2.2 Why Now**

Multimodal vision-language models (`muse-spark-1.3`), pixel-accurate promptable segmentation (`sam-3.1`), voice transcription (`muse-voice-transcribe-1.0`), and reference-grounded image editing (`muse-image-1.0`) now make it possible to parse 2D floorplan geometry, ground it against deterministic statutory databases via Model Context Protocol (MCP), and visually render corrected architectural redlines in seconds.

# **3\. Target Users, Personas & User POVs**

## **3.1 Persona 1: The Junior Municipal Permitting Clerk ("The \$15/hr Expert")**

* **Role:** Entry-level intake clerk at a City Building & Safety Department.  
* **User POV:** "*As a municipal intake clerk without an architecture degree, I receive 40 floorplan submissions a day. I need a tool where I can upload a blueprint, speak or select the occupancy type, and immediately see whether the plan passes basic ADA and IBC egress rules before I route it to our overloaded Senior Licensed Engineer.*"  
* **Key Pain Point:** Lacks technical training to measure corridor ratios or memorize IBC/ADA code sections; afraid of approving non-compliant plans or wasting senior engineers' time.

## **3.2 Persona 2: The General Contractor / ADU Builder**

* **Role:** Small-to-midsize residential and light-commercial builder.  
* **User POV:** "*As a contractor building a commercial cafe or residential ADU, every rejected permit costs my client \$15,000 in holding costs and 2 months of delay. I want to drop my draft floorplan into PlanPass before submitting to City Hall, see the exact red zones that will fail inspection, and generate a visual redline mockup I can hand to my drafter to fix today.*"  
* **Key Pain Point:** Cryptic text-only rejection letters from the city; needs visual, actionable redlines showing exactly how to modify walls and doors.

## **3.3 Persona 3: The Senior Licensed Architect / PE Reviewer**

* **Role:** Licensed Professional Engineer (PE) or Certified Building Official (CBO) responsible for final legal sign-off.  
* **User POV:** "*As a licensed reviewer, I spend 80% of my day hunting for basic dimensional violations and copy-pasting code citations. I want an AI pre-examiner to segment every door, corridor, and restroom, pre-populate the exact statutory violations, and hand me a ready-to-sign Permit Compliance Packet so I can approve plans in one click.*"  
* **Key Pain Point:** Repetitive manual measurement and report writing; requires zero-hallucination statutory citations and sovereign data privacy for sensitive facility blueprints.

# **4\. User Stories & Core Product Features**

## **4.1 Core User Stories**

* **US-01 (Blueprint Upload):** As a contractor, I want to upload a 2D floorplan image (PNG/JPEG) or select a sample commercial/residential plan so I can run an instant pre-permit check.  
* **US-02 (Voice Scope Command):** As an intake clerk, I want to hold a push-to-talk microphone button and state what to inspect (e.g., *"Check ADA restroom clearance and corridor egress width"*) so the system configures the right code checklist hands-free.  
* **US-03 (Interactive Element Segmentation):** As a plan examiner, I want to see doors, corridors, restrooms, and staircases segmented as interactive color-coded overlays on the floorplan so I can visually verify spatial boundaries.  
* **US-04 (Statutory Violation Ledger):** As a reviewer, I want every flagged violation to cite the exact IBC 2024 or ADA 2010 code section, measured value, and required threshold so there is zero ambiguity.  
* **US-05 (Generative Architectural Redline):** As a builder, I want to click one button to generate a visual redlined floorplan showing how to fix the violation (e.g., flipping a door swing or widening a hallway) so my drafter can update the CAD file immediately.  
* **US-06 (Closed-Loop Re-Verification & Sign-Off):** As a licensed PE, I want to re-run the fixed floorplan through the examiner to confirm the score reaches \>90% and export a stamped PDF permit packet and air-gapped JSONL record.

## **4.2 Prioritized Feature Matrix (MoSCoW / P0–P2)**

* **P0 (Must-Have for Hackathon MVP):**  
  * **F1: Blueprint Ingestion & Sample Library:** Drag-and-drop upload for 2D architectural floorplans (PNG, JPEG, WebP, or single-page PDF) plus 3 pre-loaded benchmark floorplans (*Commercial Cafe \- Violation State*, *Commercial Cafe \- Compliant State*, *Residential ADU Layout*).  
  * **F2: Voice-First Inspection Scope Bar:** Push-to-talk audio recorder and preset command chips allowing inspectors to state the inspection scope hands-free (e.g., *"Audit this commercial floorplan for ADA restroom clearance and IBC egress corridor width"*).  
  * **F3: Automated Architectural Element Segmentation:** Pixel-accurate segmentation of key architectural primitives (`door`, `corridor`, `bathroom`, `staircase`, `room`) rendered as interactive, color-coded SVG overlays on the blueprint canvas.  
  * **F4: Spatial Grounding & Deterministic Code Audit (MCP):** Automated cross-examination of segmented floorplan regions and normalized 0–1000 bounding boxes against verbatim IBC 2024 and ADA 2010 regulations via a local FastMCP server.  
  * **F5: Permit Readiness Score & Violation Ledger:** Real-time 0–100% readiness gauge, pass/hold status gate, and structured violation cards showing measured vs. required dimensions, severity level, and verbatim statutory citations.  
  * **F6: Generative Architectural Redlining:** One-click visual generation of a **Redlined Correction Blueprint** that preserves the original floorplan layout while overlaying crisp red architectural markups (e.g., flipping an inward door swing outward, widening a corridor bottleneck).  
  * **F7: Closed-Loop Re-Verification:** Ability to run the remediated/redlined floorplan back through the inspection engine to verify that all violations are resolved and unlock final permit approval.  
* **P1 (High-Value Differentiators included in MVP UI):**  
  * **F8: One-Click PE Sign-Off Permit Packet:** Printable/downloadable compliance report stamped with inspection metadata, visual overlays, and statutory checklist.  
  * **F9: Sovereign Open-Weights Dataset Flywheel Export:** One-click export of verified inspection records (image \+ SAM masks \+ statutory reasoning) as a JSONL fine-tuning dataset for air-gapped municipal or enterprise deployment on Modal/Baseten.  
* **P2 (Post-Hackathon Roadmap):**  
  * Multi-page DWG/DXF CAD file parsing, local municipal zoning ordinance RAG ingestion by zip code, and direct integration with Accela/Clariti municipal permitting portals.

# **5\. End-to-End User Journey & UX Specification**

## **5.1 Workspace Layout (Split-Screen Dark-Mode CAD Studio UI)**

The application uses a responsive 3-zone engineering workspace layout:

* **1\. Top Navigation & Voice Command Header:** Displays project title, occupancy selector (*Commercial Assembly*, *Business/Office*, *Residential ADU*), blueprint scale calibration (`24 px = 1 ft`), and the **Voice Scope Recorder** button with live waveform feedback and transcript pill.  
* **2\. Left/Center Main Stage — Interactive Blueprint Canvas (60% Width):** High-contrast zoomable/pannable floorplan viewport. **Layer Control Toolbar:** Toggle visibility for `All Masks`, `Doors`, `Corridors`, `Restrooms`, `Violation Bounding Boxes`, and `Side-by-Side Redline Comparison`. **Visual Encoding:** Compliant segmented regions glow translucent emerald green (`#10B981`); code-violating regions pulse crimson red (`#EF4444`) with floating callout badges (`V-01: ADA 604.3.2`, `V-02: IBC 1020.2`).  
* **3\. Right Inspector Drawer — Agent Trace, Score & Violation Ledger (40% Width):**  
  **Tab 1: Compliance Audit Ledger:** Circular **Permit Readiness Score Gauge** (`0–100%`) with status badge (`HOLD - REVISIONS REQUIRED` vs. `APPROVED FOR PE SIGN-OFF`). Expandable **Violation Cards** displaying: Violation Title, Code Section (`ADA 2010 §604.3.2`), Measured Value (*Door arc overlaps 60" turning circle by 14"*), Required Standard (*Unobstructed 60" wheelchair turning space*), and an individual **"Redline This Violation"** action button.  
  **Tab 2: Live 4-Node Agent & MCP Execution Trace:** Step-by-step collapsible log showing latency and payloads for Node 1 (`muse-voice-transcribe-1.0`), Node 2 (`sam-3.1` parallel noun segmentation), Node 3 (`muse-spark-1.3` \+ `FastMCP` statutory tool calls), and Node 4 (`muse-image-1.0` redline generation).  
  **Bottom Sticky Action Bar:** Primary CTA (when status is HOLD): **"Generate Visual Redline Fix"** → opens Side-by-Side Redline Comparison & **"Re-Verify Fixed Plan"** button. Primary CTA (when status is APPROVED): **"Download Stamped Permit PDF"** and **"Export Air-Gapped JSONL Dataset"**.

# **6\. System Architecture, Agentic Pipeline & Data Models**

## **6.1 4-Node Closed-Loop Agent Architecture**

* **Node 1 — Voice Intent & Scope Router (`muse-voice-transcribe-1.0`):** Converts push-to-talk `.wav` audio from the inspector into text and extracts target building occupancy and applicable code chapters (`IBC Chapter 10 Egress`, `ADA Chapter 6 Plumbing Elements`).  
* **Node 2 — Parallel Pixel Segmentation Engine (`sam-3.1`):** Fires concurrent requests to `sam-3.1` for atomic architectural concepts (`"door"`, `"corridor"`, `"bathroom"`, `"room"`). Parses the streamed special-token output (`<0f>...~`) into source-pixel bounding boxes and SVG path masks using `meta_sam_parser`.  
* **Node 3 — Spatial & Statutory Code Auditor (`muse-spark-1.3` \+ Local FastMCP Server):** Analyzes the floorplan image alongside the SAM 3.1 geometry summary. Uses perception grounding (`0–1000` normalized coordinates) to localize specific violations and invokes deterministic FastMCP tools (`lookup_ibc_ada_statute`, `evaluate_corridor_width`, `evaluate_ada_turning_circle`) before returning a strict JSON audit schema.  
* **Node 4 — Conversational Blueprint Redliner (`muse-image-1.0`):** Takes the original floorplan (`input_image`) and the structured remediation instructions from Node 3 (`input_text`) to generate an annotated architectural redline diagram showing how to bring the plan into compliance. Supports multi-turn refinement via `previous_response_id`.

## **6.2 Core Data Schemas (JSON Contract)**

```json
{
  "inspection_id": "insp_20261103_001",
  "readiness_score": 42,
  "status": "HOLD",
  "transcript": "Check this commercial floorplan for ADA restroom clearance and IBC corridor egress width.",
  "sam_overlays": [
    {
      "concept": "door",
      "object_id": 1,
      "box_px": [410, 220, 485, 295],
      "svg_path": "M410 220 L485 220 ...",
      "compliant": false
    }
  ],
  "violations": [
    {
      "id": "V-01",
      "title": "Restroom Door Swing Overlaps Wheelchair Turning Space",
      "code_section": "ADA 2010 §604.3.2 & §304.3",
      "severity": "CRITICAL",
      "measured_value": "46 in clear turning diameter (inward swing overlap)",
      "required_value": "60 in minimum unobstructed turning circle",
      "norm_box_1000": [400, 200, 560, 380],
      "remediation_instruction": "Flip restroom door swing outward into the alcove and add red dimension callout showing 60-inch clear turning circle."
    }
  ],
  "mcp_trace": [
    {
      "tool": "lookup_ibc_ada_statute",
      "input": {"code_id": "ADA-604.3.2"},
      "output": "ADA 2010 Section 604.3.2: The required clearance around the water closet shall be permitted to overlap the water closet, associated grab bars, dispensers, sanitary napkin disposal units, coat hooks, shelves, accessible routes, clear floor space and clearances required at other fixtures, and the turning space, provided door swing does not overlap required fixture clearance."
    }
  ]
}
```

# **7\. Non-Functional Requirements & Success Metrics**

* **Latency:** Complete floorplan segmentation and statutory audit (`POST /api/inspect`) must complete in under 8 seconds using concurrent `sam-3.1` requests; voice transcription under 1.5 seconds.  
* **Reliability & Fallback:** If live API rate limits occur during high-traffic judging, the backend must support deterministic caching for the 3 pre-loaded benchmark floorplans while executing live Meta API calls for any new user upload or voice recording.  
* **Statutory Accuracy:** 100% of cited building codes must originate from the local FastMCP statutory dictionary (`IBC 2024` and `ADA 2010`), preventing hallucinated section numbers.

# **8\. Meta Model API Integration & Documentation Reference Manual (For Xiaomi MiMo Desktop App Using Muse Model)**

**MANDATORY SYSTEM INSTRUCTION FOR XIAOMI MIMO DESKTOP / MIMO CODE HARNESS:**  
You are building PlanPass inside the **Xiaomi MiMo Desktop App / MiMo Code** environment using a Muse model as your coding backbone. Even when powered by a Muse model, your training cutoff or coding harness context may not contain the exact 2026 endpoint wire schemas for Meta's **Meta Model API** (`https://api.meta.ai/v1`).  
1\. Store the rules below in your persistent project memory (`MEMORY.md`) so they survive context compaction and checkpoints across `plan` and `build` modes.  
2\. You **MUST NOT** guess endpoints or fall back to legacy OpenAI Whisper (`/v1/audio/transcriptions`) or DALL-E patterns.  
3\. Whenever you implement, modify, or debug any model integration (`muse-spark-1.3`, `sam-3.1`, `muse-image-1.0`, `muse-voice-transcribe-1.0`), fetch or consult the official documentation URLs in **Section 8.1** and strictly follow the exact implementation patterns in **Sections 8.2 to 8.6**.

## **8.1 Official Meta AI Developer Documentation URL Index**

Whenever you need to verify parameters, schemas, streaming events, or error codes while building the software, fetch or browse these authoritative URLs:

* **Core Platform, Auth & Protocols:**  
  * Quickstart & SDK Setup: [https\://dev.meta.ai/docs/quickstart](https://dev.meta.ai/docs/quickstart)  
  * Authentication: [https\://dev.meta.ai/docs/authentication](https://dev.meta.ai/docs/authentication)  
  * Models Catalog: [https\://dev.meta.ai/docs/models](https://dev.meta.ai/docs/models)  
  * Choosing an API (`/v1/responses` vs `/v1/chat/completions`): [https\://dev.meta.ai/docs/choosing-an-api](https://dev.meta.ai/docs/choosing-an-api)  
  * Responses API Reference: [https\://dev.meta.ai/docs/api-reference/responses/create](https://dev.meta.ai/docs/api-reference/responses/create)  
* **Media Segmentation (`sam-3.1`):**  
  * Media Segmentation Guide: [https\://dev.meta.ai/docs/media-segmentation](https://dev.meta.ai/docs/media-segmentation)  
  * SAM 3.1 End-to-End Overview: [https\://dev.meta.ai/docs/sam/overview](https://dev.meta.ai/docs/sam/overview)  
  * Segmenting with Text, Box & Point Prompts: [https\://dev.meta.ai/docs/sam/segmenting](https://dev.meta.ai/docs/sam/segmenting)  
  * Reading Segmentation Output (Wire Grammar `<0f>...~`): [https\://dev.meta.ai/docs/sam/reading-output](https://dev.meta.ai/docs/sam/reading-output)  
  * SAM Client Libraries (`meta_sam_parser` / `@meta-sam/parser`): [https\://dev.meta.ai/docs/sam/client-libraries](https://dev.meta.ai/docs/sam/client-libraries)  
  * SAM API Basics Cookbook: [https\://dev.meta.ai/docs/cookbook/sam-api-basics](https://dev.meta.ai/docs/cookbook/sam-api-basics)  
* **Image Understanding, Grounding & Tool Calling (`muse-spark-1.3`):**  
  * Image Understanding & Perception Grounding: [https\://dev.meta.ai/docs/image-understanding](https://dev.meta.ai/docs/image-understanding)  
  * Structured Output (`json_schema`): [https\://dev.meta.ai/docs/structured-output](https://dev.meta.ai/docs/structured-output)  
  * Tool Calling Guide: [https\://dev.meta.ai/docs/tool-calling](https://dev.meta.ai/docs/tool-calling)  
  * Tool Calling Cookbook: [https\://dev.meta.ai/docs/cookbook/tool-function-calling](https://dev.meta.ai/docs/cookbook/tool-function-calling)  
* **Image Generation & Conversational Editing (`muse-image-1.0`):**  
  * Image Generation with Muse Image: [https\://dev.meta.ai/docs/image-generation](https://dev.meta.ai/docs/image-generation)  
  * Muse Image Cookbook (Reference Images & Multi-Turn Edits): [https\://dev.meta.ai/docs/cookbook/muse-image](https://dev.meta.ai/docs/cookbook/muse-image)  
  * Generate Image Endpoint Reference: [https\://dev.meta.ai/docs/api-reference/images/generate](https://dev.meta.ai/docs/api-reference/images/generate)  
  * Edit Image Endpoint Reference: [https\://dev.meta.ai/docs/api-reference/images/edit](https://dev.meta.ai/docs/api-reference/images/edit)  
* **Speech-to-Text (`muse-voice-transcribe-1.0`):**  
  * Voice Overview: [https\://dev.meta.ai/docs/api-reference/voice/overview](https://dev.meta.ai/docs/api-reference/voice/overview)  
  * Transcribe a Recording (`POST /v1/asr/transcribe`): [https\://dev.meta.ai/docs/api-reference/voice/transcribe](https://dev.meta.ai/docs/api-reference/voice/transcribe)  
  * Transcribe in Realtime (`wss://api.meta.ai/v1/asr/realtime`): [https\://dev.meta.ai/docs/api-reference/voice/realtime](https://dev.meta.ai/docs/api-reference/voice/realtime)  
  * Voice Schemas: [https\://dev.meta.ai/docs/api-reference/voice/schemas](https://dev.meta.ai/docs/api-reference/voice/schemas)  
  * Voice API Fundamentals Cookbook: [https\://dev.meta.ai/docs/cookbook/voice-api-fundamentals](https://dev.meta.ai/docs/cookbook/voice-api-fundamentals)

## **8.2 Global Client Initialization & Authentication**

All Meta Model API requests authenticate with `Authorization: Bearer $MODEL_API_KEY` against base URL `https://api.meta.ai/v1`.

```py
import os
from openai import OpenAI

client = OpenAI(
    base_url="https://api.meta.ai/v1",
    api_key=os.environ["MODEL_API_KEY"],
)
```

## **8.3 Integrating sam-3.1 for Blueprint Element Segmentation**

* **Reference URLs:** [https\://dev.meta.ai/docs/media-segmentation](https://dev.meta.ai/docs/media-segmentation) \| [https\://dev.meta.ai/docs/sam/overview](https://dev.meta.ai/docs/sam/overview) \| [https\://dev.meta.ai/docs/sam/reading-output](https://dev.meta.ai/docs/sam/reading-output)  
* **Critical Implementation Rules:**  
  * **1\. Use /v1/responses (client.responses.stream or client.responses.create)** with `model="sam-3.1"`.  
  * **2\. ONE Concrete Noun Phrase Per Request:** `sam-3.1` segments one concept per request (e.g., `"door"`, `"hallway"`, `"bathroom"`, `"staircase"`). **NEVER** send comma-separated lists (`"door, hallway, bathroom"`) or full sentences (`"find all doors in the floorplan"`), as `sam-3.1` will return zero matches. To segment multiple architectural elements, run concurrent requests per noun phrase.  
  * **3\. Input Block Format:** Pass a single `user` message containing `{"type": "input_text", "text": "<noun>"}` and `{"type": "input_image", "image_url": "data:image/png;base64,..."}`.  
  * **4\. Decoding Special-Token Output:** `sam-3.1` outputs compact special-token text (`<0f>` frame marker, object ordinal integer, bounding box in source pixels, and `~` mask payload). Parse it with `meta_sam_parser` in Python (`parse_image_stream`, `decode_mask_to_svg_path`, `decode_mask_to_raster`) or `@meta-sam/parser` in TypeScript (`parseImageStream`, `decodeMaskToRaster`).

```py
from concurrent.futures import ThreadPoolExecutor

ARCHITECTURAL_CONCEPTS = ["door", "corridor", "bathroom", "staircase"]

def segment_single_concept(concept: str, b64_image: str) -> dict:
    chunks = []
    with client.responses.stream(
        model="sam-3.1",
        input=[
            {
                "type": "message",
                "role": "user",
                "content": [
                    {"type": "input_text", "text": concept},
                    {
                        "type": "input_image",
                        "image_url": f"data:image/png;base64,{b64_image}",
                    },
                ],
            }
        ],
    ) as stream:
        for event in stream:
            if event.type == "response.output_text.delta":
                chunks.append(event.delta)
    return {"concept": concept, "raw_sam_stream": "".join(chunks)}

```

## **8.4 Integrating muse-spark-1.3 for Image Understanding, Perception Grounding & MCP Tool Calling**

* **Reference URLs:** [https\://dev.meta.ai/docs/image-understanding](https://dev.meta.ai/docs/image-understanding) \| [https\://dev.meta.ai/docs/structured-output](https://dev.meta.ai/docs/structured-output) \| [https\://dev.meta.ai/docs/tool-calling](https://dev.meta.ai/docs/tool-calling)  
* **Critical Implementation Rules:**  
  * **1\. Images Only in user Role:** Only attach images inside messages where `role == "user"`.  
  * **2\. Image Content Block Syntax Differences:**  
    On **Responses API (`/v1/responses`)**: Use `{"type": "input_image", "image_url": "data:image/png;base64,..."}` (plain string) and `{"type": "input_text", "text": "..."}`.  
    On **Chat Completions API (`/v1/chat/completions`)**: Use `{"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}` (nested dictionary) and `{"type": "text", "text": "..."}`.  
  * **3\. Normalized 0–1000 Coordinate System:** When prompting `muse-spark-1.3` for bounding boxes (`[x_min, y_min, x_max, y_max]`), coordinates are returned on a resolution-independent `0–1000` grid where `(0, 0)` is top-left and `(1000, 1000)` is bottom-right. Always convert back to source image pixels:

```py
def norm1000_to_pixels(box_1000: list[float], img_w: int, img_h: int) -> list[int]:
    x_min, y_min, x_max, y_max = box_1000
    return [
        round(x_min * img_w / 1000),
        round(y_min * img_h / 1000),
        round(x_max * img_w / 1000),
        round(y_max * img_h / 1000),
    ]
```

  * **4\. Tool Calling Constraint (tool\_choice="auto" ONLY):** When passing MCP tools to `muse-spark-1.3`, `tool_choice` **only accepts "auto"**. Passing `"required"`, `"none"`, or a forced function object returns `HTTP 400`.  
  * **5\. Structured Output Schema:** Enforce strict JSON output using `response_format={"type": "json_schema", "json_schema": {"name": "blueprint_audit", "strict": True, "schema": ...}}` on Chat Completions or `text={"format": {"type": "json_schema", ...}}` on the Responses API.

## **8.5 Integrating muse-image-1.0 for Architectural Blueprint Redlining**

* **Reference URLs:** [https\://dev.meta.ai/docs/image-generation](https://dev.meta.ai/docs/image-generation) \| [https\://dev.meta.ai/docs/cookbook/muse-image](https://dev.meta.ai/docs/cookbook/muse-image)  
* **Critical Implementation Rules:**  
  * **1\. Reference-Guided Editing via /v1/responses:** Pass interleaved `input_text` and `input_image` parts inside `input` to `client.responses.create(model="muse-image-1.0", ...)`.  
  * **2\. NEVER Pass Function Tools or web\_search:** `muse-image-1.0` has built-in search/grounding. Passing `web_search` or custom function tools inside `tools` throws `HTTP 400: "image models only support the image_generation tool"`. Only pass `{"type": "image_generation", ...}` inside `tools`.  
  * **3\. Extract Base64 Output by Item Type:** `response.output` contains up to three items in order: a `reasoning` summary item, an assistant `message` item, and one `image_generation_call` item. Always locate the image by filtering for `o.type == "image_generation_call"` and reading `o.result` (base64 encoded bytes).  
  * **4\. Multi-Turn Iterative Redlining:** Save `response.id` and pass it as `previous_response_id` on subsequent calls to refine the redline without resending the base image.

```py
def generate_blueprint_redline(floorplan_b64: str, remediation_instructions: str, prev_resp_id: str | None = None) -> dict:
    kwargs = {
        "model": "muse-image-1.0",
        "tools": [
            {
                "type": "image_generation",
                "enable_web_search": False,
                "enable_shell": False,
                "reasoning_strength": "low",
                "output_format": "png",
            }
        ],
    }
    if prev_resp_id:
        kwargs["previous_response_id"] = prev_resp_id
        kwargs["input"] = remediation_instructions
    else:
        kwargs["input"] = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": (
                            "Edit this architectural floorplan while keeping existing walls and rooms intact. "
                            f"Apply crisp red architectural redline markups and callout arrows for: {remediation_instructions}"
                        ),
                    },
                    {
                        "type": "input_image",
                        "image_url": f"data:image/png;base64,{floorplan_b64}",
                    },
                ],
            }
        ]

    response = client.responses.create(**kwargs)
    image_b64 = next(
        item.result for item in response.output if item.type == "image_generation_call"
    )
    return {"response_id": response.id, "redline_image_b64": image_b64}
```

## **8.6 Integrating muse-voice-transcribe-1.0 for Inspector Voice Notes**

* **Reference URLs:** [https\://dev.meta.ai/docs/api-reference/voice/transcribe](https://dev.meta.ai/docs/api-reference/voice/transcribe) \| [https\://dev.meta.ai/docs/api-reference/voice/realtime](https://dev.meta.ai/docs/api-reference/voice/realtime)  
* **Critical Implementation Rules:**  
  * **1\. Use /v1/asr/transcribe (NOT /v1/audio/transcriptions):** Meta's speech-to-text endpoint is `POST https://api.meta.ai/v1/asr/transcribe` for recorded files and `wss://api.meta.ai/v1/asr/realtime` for live WebSocket streaming.  
  * **2\. Two-Part Multipart Payload:** Send `multipart/form-data` with a JSON `request` part (`{"model": "muse-voice-transcribe-1.0", "audioEncoding": "WAV", "mode": "PUSH_TO_TALK"}`) and a binary `audio` file part.

```py
import json
import os
import requests

def transcribe_inspector_audio(wav_bytes: bytes, filename: str = "note.wav") -> dict:
    response = requests.post(
        "https://api.meta.ai/v1/asr/transcribe",
        headers={
            "Authorization": f"Bearer {os.environ['MODEL_API_KEY']}",
            "Accept": "application/json",
        },
        files={
            "request": (
                None,
                json.dumps({
                    "model": "muse-voice-transcribe-1.0",
                    "audioEncoding": "WAV",
                    "mode": "PUSH_TO_TALK",
                }),
                "application/json",
            ),
            "audio": (filename, wav_bytes, "audio/wav"),
        },
        timeout=30,
    )
    response.raise_for_status()
    return response.json()
```

