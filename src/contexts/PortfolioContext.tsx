import React, { createContext, useContext, useState } from 'react';

interface PortfolioContextType {
  portfolioValues: Record<string, number>;
  updatePortfolioValue: (walletAddress: string, value: number) => void;
}

const PortfolioContext = createContext<PortfolioContextType>({
  portfolioValues: {},
  updatePortfolioValue: () => {},
});

export const PortfolioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [portfolioValues, setPortfolioValues] = useState<Record<string, number>>({});

  const updatePortfolioValue = (walletAddress: string, value: number) => {
    setPortfolioValues(prev => ({
      ...prev,
      [walletAddress]: value
    }));
  };

  return (
    <PortfolioContext.Provider value={{ portfolioValues, updatePortfolioValue }}>
      {children}
    </PortfolioContext.Provider>
  );
};

export const usePortfolio = () => useContext(PortfolioContext); 