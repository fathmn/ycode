/**
 * Custom hook to resolve asset IDs to Asset objects
 * 
 * Provides a simple interface for components to get asset details by ID
 */

import { useEffect, useMemo } from 'react';
import { useAssetsStore } from '@/stores/useAssetsStore';
import type { Asset } from '@/types';

/**
 * Hook to get an asset by ID
 * Returns the asset object or null if not found
 * Automatically loads assets store if not already loaded
 */
export function useAsset(assetId: string | null | undefined): Asset | null {
  const { getAsset, loadAssets, isLoaded } = useAssetsStore();

  useEffect(() => {
    // Load assets if not already loaded
    if (!isLoaded) {
      loadAssets();
    }
  }, [isLoaded, loadAssets]);

  const asset = useMemo(() => {
    if (!assetId) {
      return null;
    }

    return getAsset(assetId);
  }, [assetId, getAsset]);

  return asset;
}

/**
 * Hook to get multiple assets by IDs
 * Returns an array of assets (nulls for not found)
 */
export function useAssets(assetIds: (string | null | undefined)[]): (Asset | null)[] {
  const { getAsset, loadAssets, isLoaded } = useAssetsStore();

  useEffect(() => {
    // Load assets if not already loaded
    if (!isLoaded) {
      loadAssets();
    }
  }, [isLoaded, loadAssets]);

  const assets = useMemo(
    () => assetIds.map((id) => (id ? getAsset(id) : null)),
    [assetIds, getAsset],
  );

  return assets;
}
