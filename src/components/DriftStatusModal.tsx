import React, { useState } from 'react';

interface DriftStatusData {
  position: {
    isPositionOpen: boolean;
    currentPosition?: {
      baseAssetAmount?: number;
      direction?: string;
      entryPrice?: number;
      unrealizedPnl?: number;
      pnlPercentage?: number;
      positionValue?: number;
      distanceToLiquidation?: number;
    };
    currentPrice?: number;
    accountInfo?: {
      accountHealth?: number;
      riskLevel?: string;
      freeCollateral?: number;
      maxPositionSize?: number;
      maxLeverage?: number;
      leverage?: number;
    };
  };
}

interface DriftStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  statusData: DriftStatusData | null;
  loading: boolean;
  error: string | null;
}

const DriftStatusModal: React.FC<DriftStatusModalProps> = ({
  isOpen,
  onClose,
  statusData,
  loading,
  error
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const getRiskColor = (riskLevel?: string) => {
    switch (riskLevel?.toUpperCase()) {
      case 'LOW': return '#10b981';
      case 'MEDIUM': return '#f59e0b';
      case 'HIGH': return '#ef4444';
      case 'CRITICAL': return '#dc2626';
      default: return '#6b7280';
    }
  };

  const getRiskEmoji = (riskLevel?: string) => {
    switch (riskLevel?.toUpperCase()) {
      case 'LOW': return '🟢';
      case 'MEDIUM': return '🟡';
      case 'HIGH': return '🟠';
      case 'CRITICAL': return '🔴';
      default: return '⚪';
    }
  };

  const getPnlColor = (pnl?: number) => {
    if (!pnl) return '#6b7280';
    return pnl >= 0 ? '#10b981' : '#ef4444';
  };

  const getActionRecommendations = (riskLevel?: string, accountHealth?: number) => {
    const recommendations: string[] = [];
    
    if (riskLevel === 'CRITICAL' || (accountHealth && accountHealth < 20)) {
      recommendations.push('🚨 Consider closing position immediately');
      recommendations.push('💰 Add more collateral to avoid liquidation');
    } else if (riskLevel === 'HIGH' || (accountHealth && accountHealth < 50)) {
      recommendations.push('⚠️ Monitor position closely');
      recommendations.push('💰 Consider adding collateral');
    } else if (riskLevel === 'MEDIUM') {
      recommendations.push('👀 Watch market conditions');
    } else {
      recommendations.push('✅ Position looks healthy');
    }
    
    return recommendations;
  };

  const copyToClipboard = () => {
    if (!statusData) return;
    
    const pos = statusData.position;
    const accountInfo = pos.accountInfo || {};
    
    const textData = [
      `DRIFT ACCOUNT STATUS (${accountInfo.riskLevel || 'UNKNOWN'} RISK)`,
      `Health: ${(accountInfo.accountHealth || 0).toFixed(1)}%`,
      `Free Collateral: $${(accountInfo.freeCollateral || 0).toFixed(2)} USD`,
      `Max Position Size: $${(accountInfo.maxPositionSize || 0).toFixed(2)}`,
      ``,
      `POSITION DETAILS`,
      `Status: ${pos.isPositionOpen ? 'OPEN' : 'CLOSED'}`,
      pos.currentPosition ? `SOL-PERP: ${pos.currentPosition.baseAssetAmount?.toFixed(2) || 'N/A'} ${pos.currentPosition.direction || 'UNKNOWN'}` : '',
      pos.currentPosition ? `Entry: $${pos.currentPosition.entryPrice?.toFixed(2) || 'N/A'} | Current: $${pos.currentPrice?.toFixed(2) || 'N/A'}` : '',
      pos.currentPosition ? `P&L: $${pos.currentPosition.unrealizedPnl?.toFixed(2) || 'N/A'} (${pos.currentPosition.pnlPercentage?.toFixed(2) || 'N/A'}%)` : '',
      pos.currentPosition ? `Position Value: $${pos.currentPosition.positionValue?.toFixed(2) || 'N/A'}` : '',
      pos.currentPosition ? `Distance to Liquidation: ${pos.currentPosition.distanceToLiquidation?.toFixed(2) || 'N/A'}%` : '',
      ``,
      `TRADING POWER`,
      `Current Leverage: ${(accountInfo.leverage || 0).toFixed(2)}x`,
      `Available: $${(accountInfo.freeCollateral || 0).toFixed(2)} USD`,
    ].filter(Boolean).join('\n');
    
    navigator.clipboard.writeText(textData);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: '#1e293b',
        padding: '1.5rem',
        borderRadius: '0.5rem',
        width: '90%',
        maxWidth: '600px',
        maxHeight: '80vh',
        overflowY: 'auto',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ 
            color: '#e2e8f0', 
            margin: 0,
            fontSize: '1.25rem',
            fontWeight: 'bold'
          }}>
            🔴 Drift Position Status
          </h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={copyToClipboard}
              disabled={loading || error || !statusData}
              style={{
                padding: '0.5rem',
                backgroundColor: copied ? '#10b981' : '#4b5563',
                color: 'white',
                border: 'none',
                borderRadius: '0.25rem',
                cursor: 'pointer',
                fontSize: '0.75rem',
                transition: 'background-color 0.2s'
              }}
            >
              {copied ? '✓ Copied' : '📋 Copy'}
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '0.5rem',
                backgroundColor: '#4b5563',
                color: 'white',
                border: 'none',
                borderRadius: '0.25rem',
                cursor: 'pointer',
                fontSize: '0.75rem'
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {loading && (
          <div style={{ 
            color: '#94a3b8', 
            textAlign: 'center', 
            padding: '2rem',
            fontSize: '0.875rem'
          }}>
            <div style={{ marginBottom: '1rem' }}>⏳ Loading position status...</div>
          </div>
        )}

        {error && (
          <div style={{ 
            color: '#ef4444', 
            backgroundColor: '#1f2937',
            padding: '1rem',
            borderRadius: '0.25rem',
            border: '1px solid #374151',
            fontSize: '0.875rem'
          }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {statusData && !loading && !error && (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {/* Account Status Card */}
            <div style={{
              backgroundColor: '#2d3748',
              padding: '1rem',
              borderRadius: '0.375rem',
              border: '1px solid #4b5563'
            }}>
              <h3 style={{ 
                color: '#60a5fa', 
                margin: '0 0 0.75rem 0',
                fontSize: '1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                {getRiskEmoji(statusData.position.accountInfo?.riskLevel)} Account Status
                <span style={{ 
                  color: getRiskColor(statusData.position.accountInfo?.riskLevel),
                  fontSize: '0.75rem',
                  fontWeight: 'bold'
                }}>
                  ({statusData.position.accountInfo?.riskLevel || 'UNKNOWN'} RISK)
                </span>
              </h3>
              
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontSize: '0.875rem' }}>
                  <span>Health:</span>
                  <span style={{ color: getRiskColor(statusData.position.accountInfo?.riskLevel) }}>
                    {(statusData.position.accountInfo?.accountHealth || 0).toFixed(1)}%
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontSize: '0.875rem' }}>
                  <span>Free Collateral:</span>
                  <span>${(statusData.position.accountInfo?.freeCollateral || 0).toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontSize: '0.875rem' }}>
                  <span>Max Position Size:</span>
                  <span>${(statusData.position.accountInfo?.maxPositionSize || 0).toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontSize: '0.875rem' }}>
                  <span>Max Leverage:</span>
                  <span>{statusData.position.accountInfo?.maxLeverage || 10}x</span>
                </div>
              </div>
            </div>

            {/* Position Details Card */}
            <div style={{
              backgroundColor: '#2d3748',
              padding: '1rem',
              borderRadius: '0.375rem',
              border: '1px solid #4b5563'
            }}>
              <h3 style={{ 
                color: '#60a5fa', 
                margin: '0 0 0.75rem 0',
                fontSize: '1rem'
              }}>
                📊 Position Details
              </h3>
              
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontSize: '0.875rem' }}>
                  <span>Status:</span>
                  <span style={{ color: statusData.position.isPositionOpen ? '#10b981' : '#6b7280' }}>
                    {statusData.position.isPositionOpen ? '🟢 OPEN' : '🔴 CLOSED'}
                  </span>
                </div>
                
                {statusData.position.currentPosition && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontSize: '0.875rem' }}>
                      <span>SOL-PERP:</span>
                      <span>
                        {statusData.position.currentPosition.baseAssetAmount?.toFixed(2) || 'N/A'} {statusData.position.currentPosition.direction || 'UNKNOWN'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontSize: '0.875rem' }}>
                      <span>Entry Price:</span>
                      <span>${statusData.position.currentPosition.entryPrice?.toFixed(2) || 'N/A'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontSize: '0.875rem' }}>
                      <span>Current Price:</span>
                      <span>${statusData.position.currentPrice?.toFixed(2) || 'N/A'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontSize: '0.875rem' }}>
                      <span>P&L:</span>
                      <span style={{ color: getPnlColor(statusData.position.currentPosition.unrealizedPnl) }}>
                        ${statusData.position.currentPosition.unrealizedPnl?.toFixed(2) || 'N/A'} ({statusData.position.currentPosition.pnlPercentage?.toFixed(2) || 'N/A'}%)
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontSize: '0.875rem' }}>
                      <span>Position Value:</span>
                      <span>${statusData.position.currentPosition.positionValue?.toFixed(2) || 'N/A'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontSize: '0.875rem' }}>
                      <span>Distance to Liquidation:</span>
                      <span style={{ color: getRiskColor(statusData.position.accountInfo?.riskLevel) }}>
                        {statusData.position.currentPosition.distanceToLiquidation?.toFixed(2) || 'N/A'}%
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Trading Power Card */}
            <div style={{
              backgroundColor: '#2d3748',
              padding: '1rem',
              borderRadius: '0.375rem',
              border: '1px solid #4b5563'
            }}>
              <h3 style={{ 
                color: '#60a5fa', 
                margin: '0 0 0.75rem 0',
                fontSize: '1rem'
              }}>
                ⚡ Trading Power
              </h3>
              
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontSize: '0.875rem' }}>
                  <span>Current Leverage:</span>
                  <span>{(statusData.position.accountInfo?.leverage || 0).toFixed(2)}x</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontSize: '0.875rem' }}>
                  <span>Available:</span>
                  <span>${(statusData.position.accountInfo?.freeCollateral || 0).toFixed(2)} USD</span>
                </div>
              </div>
            </div>

            {/* Recommendations Card */}
            <div style={{
              backgroundColor: '#2d3748',
              padding: '1rem',
              borderRadius: '0.375rem',
              border: '1px solid #4b5563'
            }}>
              <h3 style={{ 
                color: '#60a5fa', 
                margin: '0 0 0.75rem 0',
                fontSize: '1rem'
              }}>
                ⚠️ Actions Needed
              </h3>
              
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                {getActionRecommendations(
                  statusData.position.accountInfo?.riskLevel,
                  statusData.position.accountInfo?.accountHealth
                ).map((recommendation, index) => (
                  <div key={index} style={{ color: '#e2e8f0', fontSize: '0.875rem' }}>
                    {recommendation}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DriftStatusModal;