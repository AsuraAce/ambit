export const REPOSITORY_URL = 'https://github.com/AsuraAce/ambit';
export const ISSUES_URL = `${REPOSITORY_URL}/issues`;
export const RELEASES_URL = `${REPOSITORY_URL}/releases`;
export const GITHUB_SPONSORS_URL = 'https://github.com/sponsors/AsuraAce';
export const KO_FI_URL = 'https://ko-fi.com/astraoriondev';

export interface SupportChannel {
    id: 'issues' | 'releases';
    label: string;
    description: string;
    url: string;
}

export interface DonationProvider {
    id: 'ko-fi' | 'github-sponsors' | 'patreon';
    label: string;
    ctaLabel: string;
    url: string | null;
}

export const SUPPORT_CHANNELS: SupportChannel[] = [
    {
        id: 'issues',
        label: 'Report a bug',
        description: 'Use GitHub Issues for bugs, regressions, and concrete feature requests.',
        url: ISSUES_URL
    },
    {
        id: 'releases',
        label: 'Follow releases',
        description: 'Track new builds, release notes, and packaged downloads.',
        url: RELEASES_URL
    }
];

export const DONATION_PROVIDERS: DonationProvider[] = [
    {
        id: 'ko-fi',
        label: 'Ko-fi',
        ctaLabel: 'Buy me a coffee',
        url: KO_FI_URL
    },
    {
        id: 'github-sponsors',
        label: 'GitHub Sponsors',
        ctaLabel: 'Sponsor on GitHub',
        url: GITHUB_SPONSORS_URL
    },
    {
        id: 'patreon',
        label: 'Patreon',
        ctaLabel: 'Become a patron',
        url: null
    }
];

export const ENABLED_DONATION_PROVIDERS = DONATION_PROVIDERS.filter((provider) => !!provider.url);
