import * as React from 'react';
import { Grid, Clock, Eraser, BarChart3, Filter, Heart, Compass, Gift, HelpCircle, Settings, Aperture } from 'lucide-react';
import { ViewMode, FilterState } from '../types';

interface AppSidebarProps {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  isFilterPanelOpen: boolean;
  setIsFilterPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
  onOpenDonation: () => void;
  onOpenSlideshow: () => void;
  showSupportPulse: boolean;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  viewMode,
  setViewMode,
  filters,
  setFilters,
  isFilterPanelOpen,
  setIsFilterPanelOpen,
  onOpenSettings,
  onOpenShortcuts,
  onOpenDonation,
  onOpenSlideshow,
  showSupportPulse
}) => {
  return (
    <aside className="hidden md:flex w-20 flex-col items-center py-6 fixed left-4 top-12 bottom-4 rounded-3xl bg-white/90 dark:bg-zinc-900/95 backdrop-blur-xl border border-gray-200 dark:border-white/10 z-20 shadow-2xl transition-all duration-500 ease-spring">
      <div className="mb-8 p-3 bg-sage-500/10 dark:bg-sage-500/20 rounded-2xl shadow-lg border border-sage-500/20">
        <Aperture className="w-6 h-6 text-sage-600 dark:text-sage-300" />
      </div>

      <nav className="flex-1 flex flex-col gap-6 w-full items-center">
        <NavButton active={viewMode === 'grid' && !filters.favoritesOnly} onClick={() => { setViewMode('grid'); setFilters(f => ({ ...f, favoritesOnly: false })); }} icon={<Grid />} tooltip="Grid View" />
        <NavButton active={viewMode === 'timeline'} onClick={() => setViewMode('timeline')} icon={<Clock />} tooltip="Timeline View" />
        <NavButton active={viewMode === 'dashboard'} onClick={() => setViewMode('dashboard')} icon={<BarChart3 />} tooltip="Statistics" />
        <NavButton active={viewMode === 'maintenance'} onClick={() => setViewMode('maintenance')} icon={<Eraser />} tooltip="Maintenance" />

        <div className="h-px w-8 bg-gray-300 dark:bg-white/10 my-2" />

        <NavButton active={isFilterPanelOpen && (viewMode === 'grid' || viewMode === 'timeline' || viewMode === 'dashboard')} onClick={() => setIsFilterPanelOpen(p => !p)} icon={<Filter />} tooltip="Toggle Filters" />
        <NavButton active={filters.favoritesOnly} onClick={() => setFilters(prev => ({ ...prev, favoritesOnly: !prev.favoritesOnly }))} icon={<Heart className={filters.favoritesOnly ? "fill-red-500 text-red-500" : ""} />} tooltip="Favorites Only" />

        <button onClick={onOpenSlideshow} className="w-10 h-10 rounded-xl flex items-center justify-center transition-all group relative text-gray-500 dark:text-zinc-400 hover:text-sage-600 dark:hover:text-sage-300 hover:bg-sage-100 dark:hover:bg-sage-900/20 mt-2" title="Theater Mode / Slideshow">
          <Compass className="w-5 h-5" />
        </button>
      </nav>

      <div className="mt-auto flex flex-col items-center gap-4">
        <button onClick={onOpenDonation} className={`w-10 h-10 rounded-xl flex items-center justify-center text-gray-400 dark:text-zinc-500 hover:text-red-500 dark:hover:text-red-400 transition-all mb-2 ${showSupportPulse ? 'animate-pulse text-red-400' : ''}`} title="Support">
          <Gift className="w-5 h-5" />
        </button>
        <button onClick={onOpenShortcuts} className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-500 dark:text-zinc-500 hover:text-gray-900 dark:hover:text-white mb-2" title="Shortcuts">
          <HelpCircle className="w-5 h-5" />
        </button>
        <NavButton active={false} onClick={onOpenSettings} icon={<Settings />} tooltip="Settings" />
      </div>
    </aside>
  );
};

const NavButton = ({ active, onClick, icon, tooltip }: { active: boolean, onClick: () => void, icon: React.ReactNode, tooltip: string }) => (
  <button onClick={onClick} className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 ease-spring group relative ${active ? 'bg-sage-500 text-white shadow-lg shadow-sage-500/30' : 'text-gray-400 dark:text-zinc-500 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-600 dark:hover:text-zinc-200'}`}>
    {React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement<any>, { size: 20 }) : icon}
    <div className="absolute left-16 bg-white dark:bg-zinc-800 text-gray-800 dark:text-white text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 border border-gray-200 dark:border-white/10 shadow-xl backdrop-blur-md">{tooltip}</div>
  </button>
);