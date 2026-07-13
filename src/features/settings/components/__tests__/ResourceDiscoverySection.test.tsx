import { fireEvent, render, screen } from '../../../../test/testUtils';
import { describe, expect, it, vi } from 'vitest';
import { ResourceDiscoverySection } from '../ResourceDiscoverySection';

const defaultProps = {
    resourceFolders: [],
    isScanning: false,
    isPopulatingThumbnails: false,
    removingResourcePath: null,
    newResourcePath: '',
    setNewResourcePath: vi.fn(),
    onBrowse: vi.fn(),
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onScanNow: vi.fn()
};

describe('ResourceDiscoverySection', () => {
    it('warns when the pending resource path looks like a broad models root', () => {
        render(
            <ResourceDiscoverySection
                {...defaultProps}
                newResourcePath="D:/StableDiffusion/models"
            />
        );

        expect(screen.getByText(/This looks like a broad models root/)).toBeTruthy();
    });

    it('does not warn for a specific resource subfolder', () => {
        render(
            <ResourceDiscoverySection
                {...defaultProps}
                newResourcePath="D:/StableDiffusion/models/Lora"
            />
        );

        expect(screen.queryByText(/This looks like a broad models root/)).toBeNull();
    });

    it('warns for broad models roots already configured in settings', () => {
        render(
            <ResourceDiscoverySection
                {...defaultProps}
                resourceFolders={['D:/StableDiffusion/models']}
            />
        );

        expect(screen.getByRole('img', { name: 'Broad models root D:/StableDiffusion/models' })).toBeTruthy();
        expect(screen.getByText(/A configured models root may include false positives/)).toBeTruthy();
    });

    it('does not warn for configured resource subfolders', () => {
        render(
            <ResourceDiscoverySection
                {...defaultProps}
                resourceFolders={['D:/StableDiffusion/models/Lora']}
            />
        );

        expect(screen.queryByText(/A configured models root may include false positives/)).toBeNull();
    });

    it('labels icon-only resource folder remove buttons', () => {
        render(
            <ResourceDiscoverySection
                {...defaultProps}
                resourceFolders={['D:/StableDiffusion/models']}
            />
        );

        expect(screen.getByLabelText('Remove resource folder D:/StableDiffusion/models')).toBeTruthy();
    });

    it('disables resource folder removal while discovery work is active', () => {
        render(
            <ResourceDiscoverySection
                {...defaultProps}
                resourceFolders={['D:/StableDiffusion/models']}
                isScanning
            />
        );

        expect(
            screen.getByLabelText('Remove resource folder D:/StableDiffusion/models').hasAttribute('disabled')
        ).toBe(true);
    });

    it('disables all discovery controls and identifies the folder being removed', () => {
        render(
            <ResourceDiscoverySection
                {...defaultProps}
                resourceFolders={['D:/StableDiffusion/models', 'D:/StableDiffusion/models/Lora']}
                removingResourcePath="D:/StableDiffusion/models"
                newResourcePath="D:/StableDiffusion/models/checkpoints"
            />
        );

        expect(screen.getByRole('button', { name: 'Scan Now' }).hasAttribute('disabled')).toBe(true);
        expect(screen.getByPlaceholderText('e.g. D:/StableDiffusion/models/Lora').hasAttribute('disabled')).toBe(true);
        expect(screen.getByRole('button', { name: 'Browse for resource folder' }).hasAttribute('disabled')).toBe(true);
        expect(screen.getByRole('button', { name: 'Add Path' }).hasAttribute('disabled')).toBe(true);
        expect(screen.getByLabelText('Removing resource folder D:/StableDiffusion/models').hasAttribute('disabled')).toBe(true);
        expect(screen.getByLabelText('Remove resource folder D:/StableDiffusion/models/Lora').hasAttribute('disabled')).toBe(true);
    });

    it('forwards path editing and discovery commands', () => {
        const setNewResourcePath = vi.fn();
        const onBrowse = vi.fn();
        const onAdd = vi.fn(event => event.preventDefault());
        const onRemove = vi.fn();
        const onScanNow = vi.fn();
        render(
            <ResourceDiscoverySection
                {...defaultProps}
                resourceFolders={['D:/Models/Lora']}
                newResourcePath="D:/Models/checkpoints"
                setNewResourcePath={setNewResourcePath}
                onBrowse={onBrowse}
                onAdd={onAdd}
                onRemove={onRemove}
                onScanNow={onScanNow}
            />
        );

        fireEvent.change(screen.getByPlaceholderText('e.g. D:/StableDiffusion/models/Lora'), {
            target: { value: 'D:/Models/VAE' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Browse for resource folder' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add Path' }));
        fireEvent.click(screen.getByRole('button', { name: 'Scan Now' }));
        fireEvent.click(screen.getByLabelText('Remove resource folder D:/Models/Lora'));

        expect(setNewResourcePath).toHaveBeenCalledWith('D:/Models/VAE');
        expect(onBrowse).toHaveBeenCalled();
        expect(onAdd).toHaveBeenCalled();
        expect(onScanNow).toHaveBeenCalled();
        expect(onRemove).toHaveBeenCalledWith('D:/Models/Lora');
    });

    it('shows scanning state without requiring a progress message', () => {
        render(<ResourceDiscoverySection
            {...defaultProps}
            resourceFolders={['D:/Models/Lora']}
            isScanning
        />);

        expect(screen.getAllByRole('button', { name: 'Scanning...' })).toHaveLength(2);
    });

    it('shows the current scan progress message', () => {
        render(<ResourceDiscoverySection
            {...defaultProps}
            resourceFolders={['D:/Models/Lora']}
            isScanning
            scanProgress={{ message: 'Scanning Lora models' }}
        />);

        expect(screen.getByText('Scanning Lora models')).toBeTruthy();
    });
});
