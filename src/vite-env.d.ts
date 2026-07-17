/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_CAPTURE_MODE?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

declare module '*?worker' {
    const workerConstructor: {
        new(): Worker;
    };
    export default workerConstructor;
}

declare module '*?url' {
    const content: string;
    export default content;
}
