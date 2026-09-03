import * as React from 'react';

interface ViewerToolbarFrameProps {
    filename: string;
    actions: React.ReactNode;
    detail?: React.ReactNode;
    visible?: boolean;
}

export const ViewerToolbarFrame: React.FC<ViewerToolbarFrameProps> = ({
    filename,
    actions,
    detail,
    visible = true,
}) => (
    <div className={`pointer-events-none absolute left-0 right-0 top-0 z-20 flex items-start justify-between bg-gradient-to-b from-black via-black/50 to-transparent p-6 transition-opacity duration-500 focus-within:opacity-100 ${visible ? 'opacity-100' : 'opacity-0'}`}>
        <div className="pointer-events-auto flex min-w-0 flex-col items-start">
            <div className="max-w-full truncate rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 font-mono text-sm text-gray-300 shadow-xl backdrop-blur-md">
                {filename}
            </div>
            {detail}
        </div>
        <div className="pointer-events-auto flex items-center gap-3">{actions}</div>
    </div>
);
