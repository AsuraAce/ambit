import { useContext } from 'react';
import { LibraryContext } from '../contexts/LibraryContext';

export const useLibraryContext = () => {
  const context = useContext(LibraryContext);
  if (!context) {
    throw new Error('useLibraryContext must be used within a LibraryProvider');
  }
  return context;
};