import React, { useState, useRef, useEffect, useMemo } from 'react';

interface Token {
  mintAddress: string;
  symbol: string;
  name: string;
  logoURI?: string;
  isActive: boolean;
}

interface TokenDropdownProps {
  tokens: Token[];
  value: string;
  onChange: (mintAddress: string, token?: Token) => void;
  placeholder: string;
  style?: React.CSSProperties;
}

export const TokenDropdown: React.FC<TokenDropdownProps> = ({
  tokens,
  value,
  onChange,
  placeholder,
  style = {}
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  const selectedToken = useMemo(() => tokens.find(t => t.mintAddress === value), [tokens, value]);
  const activeTokens = useMemo(() => tokens.filter(token => token.isActive), [tokens]);

  // Filter tokens based on search term
  const filteredTokens = useMemo(() => {
    if (!searchTerm.trim()) {
      return activeTokens;
    } else {
      return activeTokens.filter(token => 
        token.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
        token.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        token.mintAddress.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
  }, [searchTerm, activeTokens]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm(''); // Clear search when closing
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSelect = (token: Token) => {
    onChange(token.mintAddress, token);
    setIsOpen(false);
    setSearchTerm(''); // Clear search when selecting
  };

  const handleDropdownToggle = () => {
    setIsOpen(!isOpen);
    if (!isOpen) {
      setSearchTerm(''); // Clear search when opening
    }
  };

  return (
    <div ref={dropdownRef} style={{ position: 'relative', ...style }}>
      {/* Dropdown Button */}
      <button
        type="button"
        onClick={handleDropdownToggle}
        style={{
          width: '100%',
          padding: '0.75rem 0.75rem 0.75rem 3rem',
          backgroundColor: '#1e293b',
          border: '1px solid #4b5563',
          borderRadius: '0.375rem',
          color: '#e2e8f0',
          fontSize: '1rem',
          fontWeight: '500',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <span>
          {selectedToken ? `${selectedToken.symbol} - ${selectedToken.name}` : placeholder}
        </span>
        <span style={{
          transform: isOpen ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.2s ease',
          fontSize: '0.75rem'
        }}>
          ▼
        </span>
      </button>

      {/* Selected Token Logo */}
      {selectedToken?.logoURI && (
        <img 
          src={selectedToken.logoURI} 
          alt={selectedToken.symbol}
          style={{
            position: 'absolute',
            left: '0.75rem',
            top: '50%',
            transform: 'translateY(-50%)',
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            pointerEvents: 'none',
            zIndex: 1,
            border: '2px solid #374151'
          }}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      )}

      {/* Dropdown Options */}
      {isOpen && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          backgroundColor: '#1e293b',
          border: '1px solid #4b5563',
          borderRadius: '0.375rem',
          marginTop: '0.25rem',
          maxHeight: '400px',
          zIndex: 10,
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
          overflow: 'hidden' // Hide scrollbar
        }}>
          {/* Search Input */}
          <div style={{
            padding: '0.75rem',
            borderBottom: '1px solid #4b5563',
            backgroundColor: '#374151'
          }}>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search tokens..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                backgroundColor: '#1e293b',
                border: '1px solid #4b5563',
                borderRadius: '0.25rem',
                color: '#e2e8f0',
                fontSize: '0.875rem',
                outline: 'none'
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setIsOpen(false);
                  setSearchTerm('');
                }
              }}
            />
          </div>

          {/* Token List with Seamless Scrolling */}
          <div style={{
            maxHeight: '300px',
            overflowY: 'auto',
            scrollbarWidth: 'none', // Firefox
            msOverflowStyle: 'none', // IE/Edge
            // Custom scrollbar styling for webkit browsers
            ...(typeof document !== 'undefined' && 'webkitScrollbar' in document.createElement('div').style ? {
              '&::-webkit-scrollbar': {
                width: '8px'
              },
              '&::-webkit-scrollbar-track': {
                backgroundColor: 'transparent'
              },
              '&::-webkit-scrollbar-thumb': {
                backgroundColor: '#4b5563',
                borderRadius: '4px',
                '&:hover': {
                  backgroundColor: '#6b7280'
                }
              }
            } : {})
          }}>
            {filteredTokens.length > 0 ? (
              filteredTokens.map((token) => (
                <button
                  key={token.mintAddress}
                  type="button"
                  onClick={() => handleSelect(token)}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    backgroundColor: 'transparent',
                    border: 'none',
                    color: '#e2e8f0',
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    fontSize: '1rem',
                    fontWeight: '500',
                    transition: 'background-color 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#334155';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  {/* Token Logo in Option */}
                  {token.logoURI ? (
                    <img 
                      src={token.logoURI} 
                      alt={token.symbol}
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        border: '2px solid #374151',
                        flexShrink: 0
                      }}
                      onError={(e) => {
                        // Show fallback avatar if image fails
                        const fallback = document.createElement('div');
                        fallback.style.cssText = `
                          width: 28px;
                          height: 28px;
                          border-radius: 50%;
                          border: 2px solid #374151;
                          background-color: #4b5563;
                          display: flex;
                          align-items: center;
                          justify-content: center;
                          font-size: 12px;
                          font-weight: bold;
                          color: #e2e8f0;
                          flex-shrink: 0;
                        `;
                        fallback.textContent = token.symbol.slice(0, 2).toUpperCase();
                        e.currentTarget.parentNode?.replaceChild(fallback, e.currentTarget);
                      }}
                    />
                  ) : (
                    // Fallback avatar when no logo
                    <div style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      border: '2px solid #374151',
                      backgroundColor: '#4b5563',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      color: '#e2e8f0',
                      flexShrink: 0
                    }}>
                      {token.symbol.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  
                  {/* Token Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ 
                      fontWeight: '600',
                      color: '#e2e8f0'
                    }}>
                      {token.symbol}
                    </div>
                    <div style={{ 
                      fontSize: '0.875rem',
                      color: '#94a3b8',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {token.name}
                    </div>
                  </div>
                </button>
              ))
            ) : (
              // No results message
              <div style={{
                padding: '1rem',
                textAlign: 'center',
                color: '#94a3b8',
                fontSize: '0.875rem'
              }}>
                {searchTerm ? `No tokens found matching "${searchTerm}"` : 'No tokens available'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};