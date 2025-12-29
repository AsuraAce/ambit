
import { useMemo } from 'react';
import { AIImage, SortOption } from '../types';

export interface TimelineGroup {
    date: string; // Display label (e.g., "Today", "August 2023")
    id: string;   // Unique key for React
    timestamp: number;
    images: AIImage[];
}

export const useTimeline = (images: AIImage[], sortOption: SortOption = 'date_desc', showPinsAsShelf: boolean = true) => {
    const groups = useMemo(() => {
        const groupsMap = new Map<string, TimelineGroup>();
        const now = new Date();

        // Normalize "Today" to midnight for comparison
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const yesterdayStart = new Date(todayStart - 86400000).getTime();
        // 30 days ago threshold
        const thirtyDaysAgo = new Date(todayStart - 30 * 86400000).getTime();

        // 1. Bucketize Images
        images.forEach(img => {
            let label = '';
            let id = '';
            let groupTimestamp = 0; // Used for sorting the groups themselves

            if (img.isPinned && showPinsAsShelf) {
                label = 'Pinned';
                id = 'pinned';
                groupTimestamp = Number.MAX_SAFE_INTEGER; // Always top
            } else {
                const imgDate = new Date(img.timestamp);
                const imgDayStart = new Date(imgDate.getFullYear(), imgDate.getMonth(), imgDate.getDate()).getTime();

                if (img.timestamp >= thirtyDaysAgo) {
                    // --- DAILY GROUPING (< 30 days) ---
                    if (imgDayStart === todayStart) {
                        label = 'Today';
                        id = 'today';
                        groupTimestamp = todayStart + 2; // Boost to ensure top
                    } else if (imgDayStart === yesterdayStart) {
                        label = 'Yesterday';
                        id = 'yesterday';
                        groupTimestamp = todayStart + 1;
                    } else {
                        label = imgDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
                        id = imgDayStart.toString();
                        groupTimestamp = imgDayStart;
                    }
                } else {
                    // --- MONTHLY GROUPING (> 30 days) ---
                    label = imgDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
                    id = `${imgDate.getFullYear()}-${imgDate.getMonth()}`;
                    // Set timestamp to start of month
                    groupTimestamp = new Date(imgDate.getFullYear(), imgDate.getMonth(), 1).getTime();
                }
            }

            if (!groupsMap.has(id)) {
                groupsMap.set(id, {
                    date: label,
                    id: id,
                    timestamp: groupTimestamp,
                    images: []
                });
            }

            groupsMap.get(id)?.images.push(img);
        });

        // 2. Convert to Array and Sort Groups
        const groupList = Array.from(groupsMap.values());

        // Sort the GROUPS themselves (Headers)
        // ALWAYS Newest -> Oldest for Timeline View structure (Fixed)
        groupList.sort((a, b) => b.timestamp - a.timestamp);

        // Debug Pinning
        // console.log('[useTimeline] Groups:', groupList.map(g => `${g.id} (${g.images.length}) TS:${g.timestamp}`)); 


        // 3. Sort Images WITHIN Groups based on user selection
        groupList.forEach(group => {
            group.images.sort((a, b) => {
                switch (sortOption) {
                    case 'name_asc': return a.filename.localeCompare(b.filename);
                    case 'name_desc': return b.filename.localeCompare(a.filename);
                    case 'size_desc': return (b.fileSize || 0) - (a.fileSize || 0);
                    case 'size_asc': return (a.fileSize || 0) - (b.fileSize || 0);
                    case 'date_asc': return a.timestamp - b.timestamp; // Oldest first within the group
                    case 'date_desc':
                    default: return b.timestamp - a.timestamp; // Newest first within the group
                }
            });
        });

        return groupList;
    }, [images, sortOption, showPinsAsShelf]);

    return { groups };
};
