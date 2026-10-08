import { getEffectiveSourceKind, type AIImage, type ViewerTab } from '../../../types';
import type { ViewerTabDefinition } from '../components/ViewerTabs';

export type ViewerTabId = ViewerTab;

export const IMAGE_VIEWER_TABS: readonly ViewerTabDefinition<ViewerTabId>[] = [
    { id: 'details', label: 'Details' },
    { id: 'metadata', label: 'Metadata' },
    { id: 'workflow', label: 'Workflow' },
];

const IMAGE_VIEWER_TABS_WITHOUT_WORKFLOW = IMAGE_VIEWER_TABS.slice(0, 2);

export const getImageViewerTabs = (image: AIImage): readonly ViewerTabDefinition<ViewerTabId>[] => {
    const isGenerated = getEffectiveSourceKind(image) === 'generated';
    return !isGenerated
        ? IMAGE_VIEWER_TABS_WITHOUT_WORKFLOW
        : image.metadata.workflowJson || image.metadata.hasWorkflowHint !== false
            ? IMAGE_VIEWER_TABS
            : IMAGE_VIEWER_TABS_WITHOUT_WORKFLOW;
};
