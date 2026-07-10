import { fireEvent, render, screen } from '../../../../test/testUtils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Zap } from 'lucide-react';
import {
    ChipSelect,
    FilterSlider,
    IconButtonSelect,
    MultiSelectDropdown,
    SearchInput,
    SectionHeader,
    SelectableRow,
    SortDropdown
} from '../FilterPrimitives';

describe('FilterPrimitives', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('toggles section headers and keeps optional action controls visible', () => {
        const onToggle = vi.fn();

        render(
            <SectionHeader
                title="Resources"
                isOpen
                onToggle={onToggle}
                isLoading
                action={<button type="button">Action</button>}
            />
        );

        fireEvent.click(screen.getByText('Resources'));

        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Action')).toBeTruthy();
    });

    it('prevents disabled rows from mutating selection', () => {
        const onClick = vi.fn();

        const { rerender } = render(
            <SelectableRow label="Flux" isSelected={false} onClick={onClick} disabled />
        );

        fireEvent.click(screen.getByText('Flux'));
        expect(onClick).not.toHaveBeenCalled();

        rerender(<SelectableRow label="Flux" isSelected onClick={onClick} />);
        fireEvent.click(screen.getByText('Flux'));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('search input reports typing and exposes clear when populated', () => {
        const onChange = vi.fn();
        const { rerender } = render(
            <SearchInput value="" onChange={onChange} placeholder="Search models..." />
        );

        fireEvent.change(screen.getByPlaceholderText('Search models...'), {
            target: { value: 'flux' }
        });
        expect(onChange).toHaveBeenCalledWith('flux');

        rerender(<SearchInput value="flux" onChange={onChange} placeholder="Search models..." />);
        fireEvent.click(screen.getByRole('button'));
        expect(onChange).toHaveBeenCalledWith('');
    });

    it('opens sort options, selects a value, and closes on outside clicks', () => {
        const onSelect = vi.fn();
        const { container } = render(
            <SortDropdown
                title="Sort by"
                currentValue="name"
                onSelect={onSelect}
                options={[
                    { id: 'name', label: 'Name', icon: Zap },
                    { id: 'count', label: 'Count' }
                ]}
                align="left"
            />
        );

        fireEvent.click(screen.getByTitle('Sort Options'));
        expect(screen.getByText('Sort by')).toBeTruthy();

        fireEvent.click(screen.getByText('Count'));
        expect(onSelect).toHaveBeenCalledWith('count');
        expect(screen.queryByText('Sort by')).toBeNull();

        fireEvent.click(screen.getByTitle('Sort Options'));
        fireEvent.mouseDown(document.body);
        expect(container.textContent).not.toContain('Sort by');
    });

    it('filters grouped multi-select options, toggles selection, and clears selected values', () => {
        const onChange = vi.fn();

        render(
            <MultiSelectDropdown
                label="LoRAs"
                selected={['Watercolor']}
                onChange={onChange}
                groups={[
                    { label: 'Used', items: ['Watercolor', 'Line Art'] },
                    { label: 'Local', items: ['Portrait Plus'] }
                ]}
                placeholder="Search LoRAs..."
            />
        );

        fireEvent.click(screen.getByText('Watercolor'));
        fireEvent.change(screen.getByPlaceholderText('Search LoRAs...'), {
            target: { value: 'portrait' }
        });

        expect(screen.queryByText('Line Art')).toBeNull();
        fireEvent.click(screen.getByText('Portrait Plus'));
        expect(onChange).toHaveBeenCalledWith(['Watercolor', 'Portrait Plus']);

        fireEvent.click(screen.getByText('Clear (1)'));
        expect(onChange).toHaveBeenCalledWith([]);
    });

    it('shows no-match state for flat multi-select options', () => {
        render(
            <MultiSelectDropdown
                label="Models"
                selected={[]}
                onChange={vi.fn()}
                options={['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta']}
            />
        );

        fireEvent.click(screen.getByText('Select...'));
        fireEvent.change(screen.getByPlaceholderText('Search...'), {
            target: { value: 'missing' }
        });

        expect(screen.getByText('No matches found')).toBeTruthy();
    });

    it('dims unavailable chips but always allows selected unavailable chips to be removed', () => {
        const onChange = vi.fn();
        const { container, rerender } = render(
            <ChipSelect
                label="Samplers"
                options={['Euler', 'DPM++']}
                selected={[]}
                onChange={onChange}
                availableOptions={['Euler']}
            />
        );

        fireEvent.click(screen.getByText('DPM++'));
        expect(onChange).not.toHaveBeenCalled();

        rerender(
            <ChipSelect
                label="Samplers"
                options={['Euler', 'DPM++']}
                selected={['DPM++']}
                onChange={onChange}
                availableOptions={['Euler']}
                formatLabel={(value) => `Sampler: ${value}`}
            />
        );
        fireEvent.click(screen.getByText('Sampler: DPM++'));
        expect(onChange).toHaveBeenCalledWith([]);

        rerender(
            <ChipSelect label="Empty" options={[]} selected={[]} onChange={onChange} />
        );
        expect(container.textContent).toBe('');
    });

    it('toggles icon button selections by id', () => {
        const onChange = vi.fn();
        const { rerender } = render(
            <IconButtonSelect
                label="Guidance"
                options={[{ id: 'canny', label: 'Canny', icon: Zap }]}
                selected={[]}
                onChange={onChange}
            />
        );

        fireEvent.click(screen.getByText('Canny'));
        expect(onChange).toHaveBeenCalledWith(['canny']);

        rerender(
            <IconButtonSelect
                label="Guidance"
                options={[{ id: 'canny', label: 'Canny', icon: Zap }]}
                selected={['canny']}
                onChange={onChange}
            />
        );
        fireEvent.click(screen.getByText('Canny'));
        expect(onChange).toHaveBeenCalledWith([]);
    });

    it('commits slider bounds only on mouse up so dragging stays local', () => {
        const onChange = vi.fn();
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
            x: 0,
            y: 0,
            width: 100,
            height: 20,
            top: 0,
            right: 100,
            bottom: 20,
            left: 0,
            toJSON: () => ({})
        });
        const { container } = render(
            <FilterSlider
                label="Steps"
                min={0}
                max={10}
                step={1}
                minValue={0}
                maxValue={10}
                onChange={onChange}
            />
        );
        const thumbs = container.querySelectorAll('.cursor-ew-resize');

        fireEvent.mouseDown(thumbs[0], { clientX: 0 });
        fireEvent.mouseMove(window, { clientX: 40 });
        expect(onChange).not.toHaveBeenCalled();

        fireEvent.mouseUp(window);
        expect(onChange).toHaveBeenCalledWith(4, undefined);
    });
});
