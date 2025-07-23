import React, { useState, useRef, useEffect } from 'react';

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
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  const selectedToken = tokens.find(t => t.mintAddress === value);
  const activeTokens = tokens.filter(token => token.isActive);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (token: Token) => {
    onChange(token.mintAddress, token);
    setIsOpen(false);
  };

  return (
    <div ref={dropdownRef} style={{ position: 'relative', ...style }}>
      {/* Dropdown Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
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
          maxHeight: '300px',
          overflowY: 'auto',
          zIndex: 10,
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
        }}>
          {activeTokens.map((token) => (
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
          ))}
        </div>
      )}
    </div>
  );
};