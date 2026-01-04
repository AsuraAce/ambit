---
description: Step-by-step guide to adding a new backend command.
---

1. **Define Rust Function**
   - In `src-tauri/src/commands/` (or appropriate module), define your function.
   - Decorate with `#[tauri::command]`.
   - Make it `async` if it involves I/O.
   - Return `Result<T, String>` or similar.

2. **Register Command**
   - In `src-tauri/src/lib.rs` (or where the builder is), add the function to `.invoke_handler(tauri::generate_handler![...])`.

3. **Define TypeScript Types**
   - Create/Update interface in `src/types/tauri.ts` (or relevant feature type file).
   - Ensure specific arguments and return types match the Rust struct.

4. **Implement Frontend Helper**
   - In `src/api/` or `src/features/<feature>/api.ts`.
   - Use `invoke` from `@tauri-apps/api/core`.
   - Example:
     ```typescript
     export async function myCommand(arg: string): Promise<MyResult> {
       return await invoke("my_command", { arg });
     }
     ```
