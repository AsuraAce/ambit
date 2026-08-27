import * as React from 'react';
import { Info } from 'lucide-react';
import { MetadataSectionHeader } from './MetadataSectionHeader';

export interface TechnicalDetail {
    label: string;
    value: string;
}

export const AssetTechnicalDetails: React.FC<{ rows: readonly TechnicalDetail[] }> = ({ rows }) => (
    <section>
        <MetadataSectionHeader title="Technical details" icon={Info} />
        <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            {rows.map(row => (
                <React.Fragment key={row.label}>
                    <dt className="text-zinc-500">{row.label}</dt>
                    <dd>{row.value}</dd>
                </React.Fragment>
            ))}
        </dl>
    </section>
);
