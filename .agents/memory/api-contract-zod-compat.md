---
name: OpenAPI integer compatibility
description: OpenAPI integer schemas can generate zod.int calls that fail against the workspace's Zod 3 runtime.
---

When adding numeric fields to the shared OpenAPI contract, prefer `number` unless integer-specific validation is required and the generated Zod runtime has been upgraded.

**Why:** The current code generator can emit Zod 4-style `z.int()` while the workspace runtime still resolves Zod 3, which breaks the chained library typecheck after otherwise successful codegen.

**How to apply:** After every contract change, run codegen and the library typecheck before relying on generated hooks; if integer semantics are needed, verify the generated Zod output and package versions together.