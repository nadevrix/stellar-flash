# spec · vectores de prueba cruzados

`merkle-vectors.txt` lo generan por igual:
- Rust: `cd contracts && cargo test print_vectors -- --nocapture | grep VECTOR`
- TypeScript: `node scripts/gen-vectors.ts`

Si cambian las reglas de hashing (tags, orden de campos, codificación), ambos deben cambiar y este archivo se regenera.
Regla de oro: el contrato y el secuenciador deben producir **exactamente** los mismos bytes.
