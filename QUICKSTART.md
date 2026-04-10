# Get Up and Running

You can get your extension up in a few minutes!

> [!INFO]
>
> If `npm` reports vulnerabilities, please use GitHub's security reporting feature or send an e-mail to `triflare.dev@proton.me`. We aim to acknowledge reports within 72 hours and provide a full response within 90 days.

1. Run `npm ci`.

2. Run `npm run fullstack`.
3. Copy the file in `build/extension.js`.
4. Open TurboWarp and enter the custom extension import screen.
5. Choose "Text" _(or "File" if you have it downloaded)_, then paste `build/extension.js`'s content into the box below. Click "Run unsandboxed" and "Load".
6. You're done! If the extension does not add any blocks to your palette, check your console by pressing `ctrl + shift + i` and clicking "Console". If there are any errors after the string of random characters you'll see after importing the extension, contact the repository's developer _(us if you're running this from `triflare/mint-tooling`)_.

It's that simple!

# Local Preview Server (faster iteration)

Instead of copying and pasting the built extension on every change, you can run a local HTTP server that lets TurboWarp reload the extension directly from your machine.

1. Run `npm run serve`.  
   This builds the extension, starts watching `src/` for changes, and serves `build/` over HTTP at `http://127.0.0.1:3000/`.

2. In TurboWarp, open the custom extension screen and choose **URL**, then enter:

   ```text
   http://127.0.0.1:3000/extension.js
   ```

   Click **Run unsandboxed** and **Load**.

3. When you save a source file, Mint rebuilds automatically.  
   To reload the updated extension in TurboWarp, remove and re-add it via the custom extension screen using the same URL.

> [!NOTE]
>
> The server binds to `127.0.0.1` (localhost) and is not reachable from other machines.  
> To use a different port, set the `PORT` environment variable before starting the server:
>
> ```text
> PORT=8080 npm run serve
> ```

# Build Your Extension

> [!INFO]
>
> We have since removed this section to remove the overhead of updating this field if TurboWarp's extension system changes. **If you want guidance, see [TurboWarp's documentation](https://docs.turbowarp.org/development/extensions/introduction).**

# Choosing the Right Build Output

Every successful build produces at least `build/extension.js` and a `build/BUILD_REPORT.md` that summarises the available artifacts. When optional tools are installed, additional variants may be created:

| File                  | Best for                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `extension.js`        | General development and iteration                                                            |
| `min.extension.js`    | Production deployment — smallest download size _(only generated when `terser` is available)_ |
| `pretty.extension.js` | Debugging — fully formatted, easy to read _(only generated when `prettier` is available)_    |

Run `npm run build:recommended` (or plain `npm run build`) to generate the report.  
Open `build/BUILD_REPORT.md` after the build completes to see the sizes of each artifact and a **tailored recommendation** for your specific bundle. For optional artifacts that could not be built, the report will list them as **"not generated"**.

> **Rule of thumb:** if your standard build exceeds 50 KB, `BUILD_REPORT.md` will recommend `min.extension.js` for production (when available). For step-through debugging always reach for `pretty.extension.js` if it was generated.
