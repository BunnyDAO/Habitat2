import React, { useState, useEffect } from 'react';
import { BrowseStrategiesRequest } from '../../types/strategy-marketplace';
import { API_CONFIG } from '../../config/api';
import './StrategyFilters.css';

interface StrategyFiltersProps {
  filters: BrowseStrategiesRequest;
  onFilterChange: (filters: Partial<BrowseStrategiesRequest>) => void;
}

export const StrategyFilters: React.FC<StrategyFiltersProps> = ({ filters, onFilterChange }) => {
  const [categories, setCategories] = useState<string[]>([]);
  const [popularTags, setPopularTags] = useState<{ tag: string; count: number }[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    loadFilterOptions();
  }, []);

  const loadFilterOptions = async () => {
    try {
      const token = localStorage.getItem('auth.token');
      if (!token) return;

      // Load categories
      const categoriesResponse = await fetch(`${API_CONFIG.BASE_URL}/api/shop/categories`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (categoriesResponse.ok) {
        const categoriesData = await categoriesResponse.json();
        setCategories(categoriesData.categories);
      }

      // Load popular tags
      const tagsResponse = await fetch(`${API_CONFIG.BASE_URL}/api/shop/tags`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (tagsResponse.ok) {
        const tagsData = await tagsResponse.json();
        setPopularTags(tagsData.tags.slice(0, 10)); // Top 10 tags
      }
    } catch (error) {
      console.error('Failed to load filter options:', error);
    }
  };

  const handleCategoryChange = (category: string) => {
    onFilterChange({ 
      category: category === filters.category ? undefined : category 
    });
  };

  const handleTagToggle = (tag: string) => {
    const currentTags = filters.tags || [];
    const newTags = currentTags.includes(tag)
      ? currentTags.filter(t => t !== tag)
      : [...currentTags, tag];
    
    onFilterChange({ 
      tags: newTags.length > 0 ? newTags : undefined 
    });
  };

  const handleSortChange = (sortBy: string, sortOrder: 'asc' | 'desc') => {
    onFilterChange({ sortBy: sortBy as any, sortOrder });
  };

  const clearFilters = () => {
    onFilterChange({
      category: undefined,
      tags: undefined,
      minRating: undefined,
      maxRequiredWallets: undefined,
      sortBy: 'rating',
      sortOrder: 'desc'
    });
  };

  const hasActiveFilters = filters.category || filters.tags?.length || 
                          filters.minRating || filters.maxRequiredWallets;

  return (
    <div className="strategy-filters">
      <div className="filters-header">
        <h3>Filter Strategies</h3>
        <div className="filter-actions">
          <button 
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="toggle-advanced"
          >
            {showAdvanced ? 'Hide' : 'Show'} Advanced
          </button>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="clear-filters">
              Clear All
            </button>
          )}
        </div>
      </div>

      <div className="filters-content">
        {/* Sort Options */}
        <div className="filter-group">
          <label>Sort By</label>
          <div className="sort-options">
            <select 
              value={`${filters.sortBy}-${filters.sortOrder}`}
              onChange={(e) => {
                const [sortBy, sortOrder] = e.target.value.split('-');
                handleSortChange(sortBy, sortOrder as 'asc' | 'desc');
              }}
            >
              <option value="rating-desc">Highest Rated</option>
              <option value="downloads-desc">Most Popular</option>
              <option value="roi-desc">Best ROI</option>
              <option value="recent-desc">Recently Published</option>
            </select>
          </div>
        </div>

        {/* Categories */}
        <div className="filter-group">
          <label>Strategy Type</label>
          <div className="category-filters">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => handleCategoryChange(category)}
                className={`category-filter ${filters.category === category ? 'active' : ''}`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>

        {/* Popular Tags */}
        <div className="filter-group">
          <label>Tags</label>
          <div className="tag-filters">
            {popularTags.map(({ tag, count }) => (
              <button
                key={tag}
                onClick={() => handleTagToggle(tag)}
                className={`tag-filter ${filters.tags?.includes(tag) ? 'active' : ''}`}
              >
                {tag} ({count})
              </button>
            ))}
          </div>
        </div>

        {/* Advanced Filters */}
        {showAdvanced && (
          <div className="advanced-filters">
            <div className="filter-group">
              <label>Minimum Rating</label>
              <select 
                value={filters.minRating || ''}
                onChange={(e) => onFilterChange({ 
                  minRating: e.target.value ? parseFloat(e.target.value) : undefined 
                })}
              >
                <option value="">Any Rating</option>
                <option value="1">1+ Stars</option>
                <option value="2">2+ Stars</option>
                <option value="3">3+ Stars</option>
                <option value="4">4+ Stars</option>
                <option value="4.5">4.5+ Stars</option>
              </select>
            </div>

            <div className="filter-group">
              <label>Max Required Wallets</label>
              <select 
                value={filters.maxRequiredWallets || ''}
                onChange={(e) => onFilterChange({ 
                  maxRequiredWallets: e.target.value ? parseInt(e.target.value) : undefined 
                })}
              >
                <option value="">Any Number</option>
                <option value="1">1 Wallet</option>
                <option value="2">2 Wallets</option>
                <option value="3">3 Wallets</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Active Filters Display */}
      {hasActiveFilters && (
        <div className="active-filters">
          <span className="active-filters-label">Active filters:</span>
          {filters.category && (
            <span className="active-filter">
              Category: {filters.category}
              <button onClick={() => onFilterChange({ category: undefined })}>×</button>
            </span>
          )}
          {filters.tags?.map((tag) => (
            <span key={tag} className="active-filter">
              {tag}
              <button onClick={() => handleTagToggle(tag)}>×</button>
            </span>
          ))}
          {filters.minRating && (
            <span className="active-filter">
              Min Rating: {filters.minRating}+
              <button onClick={() => onFilterChange({ minRating: undefined })}>×</button>
            </span>
          )}
          {filters.maxRequiredWallets && (
            <span className="active-filter">
              Max Wallets: {filters.maxRequiredWallets}
              <button onClick={() => onFilterChange({ maxRequiredWallets: undefined })}>×</button>
            </span>
          )}
        </div>
      )}
    </div>
  );
};