---
name: add_tauri_command
description: Workflow for adding new Rust commands to the Tauri backend.
---

# Add Tauri Command Skill

Use this skill when adding functionality to the Rust backend that needs to be callable from the frontend.

## 1. Define the Command
Create or modify a file in `src-tauri/src/`.
Reference the `rust.md` rule for style.

### Template
```rust
use tauri::State;
use crate::error::CommandResult; // Assuming a custom result type exists, else Result<T, String>

#[tauri::command]
pub async fn my_new_command(
    app_handle: tauri::AppHandle,
    input_data: String,
) -> CommandResult<String> {
    // Implementation
    println!("Received: {}", input_data);
    
    Ok("Success".to_string())
}
```

## 2. Register Validation
You MUST register the command in the plugin builder or main application builder.

If using `tauri-plugin-specta` or similar auto-export:
- check where `specta::collect_commands!` is called (usually `lib.rs` or a specific plugin file).

If manually registering:
- Open `src-tauri/src/main.rs` (or `lib.rs`).
- Add to the `invoke_handler`:
```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands
    my_module::my_new_command,
])
```

## 3. Update Frontend Types
Ensures TypeScript knows about the new command.

- If using `specta`: Run `npm run tauri:bindings` (or equivalent) if it doesn't auto-run.
- If manual: Update `src/types/tauri.d.ts` or relevant service file to match the signature.

## 4. Checklist
- [ ] **Async**: Is the command `async`?
- [ ] **Result**: Does it return `Result<T, E>`?
- [ ] **Registration**: Added to `generate_handler!`?
- [ ] **Types**: Frontend types updated?
- [ ] **Clippy**: Ran `cargo clippy` to check for warnings?
