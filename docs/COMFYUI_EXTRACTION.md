# ComfyUI Metadata Extraction Strategy

## Philosophy

ComfyUI metadata is notoriously difficult to parse because, unlike A1111, it is a **graph execution engine**, not a linear form. The "metadata" stored in images is often just the *input workflow* (the graph), not the *runtime execution parameters*.

Our philosophy for extracting metadata (Prompt, Model, Sampler Settings) is **"Simulation over Extraction"**. We attempt to simulate the logic of ComfyUI's execution graph to determine *what likely happened* during generation, rather than just regex-matching text in the file.

## Architecture: The 4-Layer Model

We employ a "Fall-Through" strategy with 4 layers of decreasing precision but increasing coverage.

### Layer 1: Archival (Workflow JSON)
*   **Source**: `workflow` or `prompt` JSON chunks.
*   **Logic**: Just archive the raw JSON. This ensures we never lose data, even if we can't parse it yet.

### Layer 2: Explicit Metadata Nodes (User Override)
*   **Source**: Nodes specifically designed to embed metadata (e.g., `SDPromptSaver`, `ImageSaveWithMetadata`).
*   **Logic**: Trust these nodes implicitly. If a user connected an `SDPromptSaver` node, the values inside it (filename strings, manual inputs) are the "Truth".

### Layer 3: Graph Evaluator (The "Smart" Layer)
This is the core of our optimization. We employ a static analysis engine that traverses the node graph Backwards (Output -> Input).

*   **Logic**:
    1.  **Find Output Nodes**: Locate `SaveImage`, `PreviewImage`.
    2.  **Backtrack**: Trace links upstream to find the **Sampler** responsible for the image.
    3.  **Sampler Evaluation**: Once a KSampler is found, we extract Steps, CFG, and Scheduler.
    4.  **Recursive Tracing**:
        *   **Model**: Trace from Sampler -> `LoraLoader` -> `CheckpointLoader`. This captures the *entire* LoRA chain.
        *   **Prompts**: Trace from Sampler -> `ControlNetApply` -> `CLIPTextEncode`. This captures the prompt *and* any ControlNets used.
*   **Feature: Wireless Resolution**: We use heuristics to resolve "Use Everywhere" / "Wireless" nodes where links are missing in the JSON but present in the runtime.

### Layer 4: Global Scan (The Fallback)
If the graph is broken, disconnected, or uses unknown custom nodes that block traversal:
*   **Logic**: Scan *every* node in the graph regardless of connections.
*   **Heuristics**: Look for nodes named "KSampler", "CheckpointLoader", etc., and just grab their values. This is less accurate (might grab a disconnected test node) but better than nothing.

## Technical Implementation

*   **Language**: Rust (`src-tauri/src/metadata/comfyui`)
*   **Key Files**:
    *   `evaluator.rs`: The graph traversal and recursion engine.
    *   `heuristics.rs`: Wireless node matching logic.
    *   `strategies.rs`: The layer orchestration.

## Known Limitations & Findings

### 1. The "smZ / Ollama" Edge Case (Ollama Chain Failure)
**Status**: Deferred / Open Issue
**Impact**: ~0.2% of dataset (approx 35/18k images).

**Description**:
We encountered a workflow where the Positive Prompt was a chain of:
`KSampler` <- `smZ CLIPTextEncode` <- `JoinStringMulti` <- `easy showAnything` <- `Remove Text` <- `OllamaGenerateV2`.

**The Failure**:
The link between `Remove Text` (Node 795) and `OllamaGenerateV2` (Node 791) appeared to be broken or non-standard in the API format JSON. The generic recursive tracer failed to cross this gap, resulting in an empty Positive Prompt.

**Attempted Fixes**:
1.  **Recursive Depth**: Increased recursion depth (did not help).
2.  **Widget Fallback**: Attempted to read `widgets_values[1]` (the standard prompt text widget) from `OllamaGenerate` when links were missing. This logic works in unit tests but failed on the specific user reproduction data, suggesting a subtle mismatch in how `Ollama` stores its inputs (possibly dynamic execution results that are not persisted in the workflow metadata at all).

**Resolution**:
Given the low impact and high complexity of creating a custom evaluator for the dynamic execution of Ollama nodes (which generate text at runtime), we have decided to defer this edge case. The system falls back to partial metadata (Model, Sampler are correct; Prompt is missing).
