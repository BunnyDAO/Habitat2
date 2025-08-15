import React, { useState, useEffect } from 'react';
import walletStyles from '../styles/Wallet.module.css';

interface DriftWithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (amount: number | null) => Promise<void>;
  jobId: string;
  freeCollateral?: number;
}

const DriftWithdrawModal: React.FC<DriftWithdrawModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  jobId,
  freeCollateral = 0
}) => {
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setWithdrawAmount('');
      setIsProcessing(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (isProcessing) return;
    
    try {
      setIsProcessing(true);
      const amount = withdrawAmount === '' ? null : Number(withdrawAmount);
      await onConfirm(amount);
      onClose();
    } catch (error) {
      console.error('Error in withdraw transaction:', error);
      // Error notification will be shown by parent component
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancel = () => {
    setWithdrawAmount('');
    onClose();
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
        maxWidth: '400px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
      }}>
        <h3 style={{ 
          color: '#e2e8f0', 
          marginTop: 0,
          marginBottom: '1rem'
        }}>
          Withdraw from Drift Collateral
        </h3>

        {/* Free Collateral Display */}
        <div style={{
          backgroundColor: '#374151',
          border: '1px solid #4b5563',
          borderRadius: '0.5rem',
          padding: '0.75rem',
          marginBottom: '1rem'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
              Available to Withdraw:
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ 
                color: '#10b981', 
                fontWeight: '600',
                fontSize: '1rem'
              }}>
                {freeCollateral.toFixed(4)} SOL
              </span>
            </div>
          </div>
          {freeCollateral > 0 && (
            <div style={{ 
              marginTop: '0.5rem',
              display: 'flex',
              gap: '0.5rem'
            }}>
              <button
                onClick={() => setWithdrawAmount((freeCollateral * 0.25).toFixed(4))}
                style={{
                  background: '#4b5563',
                  border: '1px solid #6b7280',
                  color: '#e5e7eb',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '0.25rem',
                  fontSize: '0.75rem',
                  cursor: 'pointer'
                }}
              >
                25%
              </button>
              <button
                onClick={() => setWithdrawAmount((freeCollateral * 0.5).toFixed(4))}
                style={{
                  background: '#4b5563',
                  border: '1px solid #6b7280',
                  color: '#e5e7eb',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '0.25rem',
                  fontSize: '0.75rem',
                  cursor: 'pointer'
                }}
              >
                50%
              </button>
              <button
                onClick={() => setWithdrawAmount((freeCollateral * 0.75).toFixed(4))}
                style={{
                  background: '#4b5563',
                  border: '1px solid #6b7280',
                  color: '#e5e7eb',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '0.25rem',
                  fontSize: '0.75rem',
                  cursor: 'pointer'
                }}
              >
                75%
              </button>
              <button
                onClick={() => setWithdrawAmount(freeCollateral.toFixed(4))}
                style={{
                  background: '#4b5563',
                  border: '1px solid #6b7280',
                  color: '#e5e7eb',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '0.25rem',
                  fontSize: '0.75rem',
                  cursor: 'pointer'
                }}
                title="Withdraw all available"
              >
                Max
              </button>
            </div>
          )}
        </div>
        
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ 
            display: 'block',
            marginBottom: '0.5rem',
            color: '#94a3b8'
          }}>
            Amount (SOL) - Leave empty to withdraw all
          </label>
          <input
            type="number"
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            placeholder="0.0 (empty = withdraw all)"
            step="0.1"
            min="0"
            max={freeCollateral}
            style={{
              width: '100%',
              padding: '0.5rem',
              backgroundColor: '#2d3748',
              border: '1px solid #4b5563',
              borderRadius: '0.375rem',
              color: '#e2e8f0'
            }}
          />
          {withdrawAmount && Number(withdrawAmount) > freeCollateral && (
            <div style={{ 
              color: '#ef4444', 
              fontSize: '0.75rem', 
              marginTop: '0.25rem' 
            }}>
              Amount exceeds available collateral
            </div>
          )}
        </div>
        
        <div style={{
          display: 'flex',
          gap: '0.5rem',
          justifyContent: 'flex-end'
        }}>
          <button
            onClick={handleCancel}
            disabled={isProcessing}
            className={`${walletStyles.button} ${walletStyles.secondary}`}
            style={{
              opacity: isProcessing ? 0.5 : 1,
              cursor: isProcessing ? 'not-allowed' : 'pointer'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isProcessing || (withdrawAmount && Number(withdrawAmount) > freeCollateral) || freeCollateral === 0}
            className={walletStyles.button}
            style={{
              backgroundColor: isProcessing ? '#6b7280' : '#10b981',
              opacity: (isProcessing || (withdrawAmount && Number(withdrawAmount) > freeCollateral) || freeCollateral === 0) ? 0.5 : 1,
              cursor: (isProcessing || (withdrawAmount && Number(withdrawAmount) > freeCollateral) || freeCollateral === 0) ? 'not-allowed' : 'pointer'
            }}
          >
            {isProcessing ? 'Processing...' : 'Withdraw'}
          </button>
        </div>

        {freeCollateral === 0 && (
          <div style={{
            marginTop: '1rem',
            padding: '0.75rem',
            backgroundColor: '#374151',
            border: '1px solid #f59e0b',
            borderRadius: '0.375rem',
            color: '#f59e0b',
            fontSize: '0.875rem',
            textAlign: 'center'
          }}>
            ⚠️ No free collateral available to withdraw
          </div>
        )}
      </div>
    </div>
  );
};

export default DriftWithdrawModal;