# Counter Contract Demo

A simple dApp demonstrating the **Counter Contract** using the `#[contract]` macro from `dusk-wasm`.

## Setup

1. **Build the contract and data-driver:**

   ```bash
   cd /path/to/my-first-contract
   make build    # builds both contract and data-driver WASM
   make tree     # shows output files
   ```

   Output files:
   - `target/stripped/counter_contract.wasm` - Contract WASM (for deployment)
   - `target/stripped/counter_data_driver.wasm` - Data-driver WASM (for the frontend)

2. **Copy the data-driver WASM:**

   ```bash
   cp /path/to/my-first-contract/target/stripped/counter_data_driver.wasm \
      /path/to/connect/examples/counter-demo/public/data_driver.wasm
   ```

3. **Deploy the contract** (via Rusk CLI or other deployment method) and note the contract ID.

4. **Serve the demo:**

   ```bash
   cd /path/to/connect
   npm install
   npm run build
   npx http-server -c-1 .
   ```

   Then open: `http://localhost:8080/examples/counter-demo/`

5. **Configure the demo:**
   - Enter your deployed contract ID
   - Select the network (devnet/testnet/mainnet)
   - Click "Apply & reload"

## Contract Methods

| Method | Type | Description |
|--------|------|-------------|
| `read_value()` | read | Returns the current counter value (u32) |
| `increment()` | write | Increments the counter by 1 |
| `init(u32)` | write | Initializes/resets the counter to a given value |

## Testing the Macro

This demo tests that the `#[contract]` macro correctly generates:

1. **Extern wrappers** - The contract WASM exports `read_value`, `increment`, and `init`
2. **Data-driver** - The `encode_input_fn` and `decode_output_fn` work correctly for:
   - `read_value`: input `()`, output `u32`
   - `increment`: input `()`, output `()`
   - `init`: input `u32`, output `()`

If you see `Unsupported("fn_name ...")` errors, it means the data-driver doesn't recognize
the function name - check that you're using the correct WASM file.
