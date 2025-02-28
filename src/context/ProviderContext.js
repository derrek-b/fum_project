import { createContext, useContext } from "react";

const ProviderContext = createContext();

export const ProviderProvider = ({ children, provider }) => {
  return (
    <ProviderContext.Provider value={provider}>
      {children}
    </ProviderContext.Provider>
  );
};

export const useProvider = () => {
  const context = useContext(ProviderContext);
  if (!context) {
    throw new Error("useProvider must be used within a ProviderProvider");
  }
  return context;
};

export default ProviderContext;
