import React from 'react';

const Login = () => {
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center text-gray-100 p-4">
      <div className="max-w-md w-full bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl flex flex-col items-center">
        <div className="w-16 h-16 bg-blue-500 rounded-xl flex items-center justify-center mb-6 shadow-lg shadow-blue-500/20">
          <span className="text-2xl font-bold font-serif text-white">P</span>
        </div>
        
        <h1 className="text-2xl font-bold mb-2">Welcome to Profit Tracker</h1>
        <p className="text-gray-400 text-center mb-8">Sign in to track your arbitrage and optimize your cashflow.</p>
        
        {window.location.search.includes('error') && (
          <div className="w-full bg-red-950/50 border border-red-900/50 text-red-400 px-4 py-3 rounded-xl mb-6 text-sm text-center">
            Login failed. Please try again.
          </div>
        )}

        <button 
          onClick={() => window.location.href = `${import.meta.env.VITE_API_DIRECT_URL || import.meta.env.VITE_API_URL}/auth/discord`}
          className="w-full flex items-center justify-center space-x-3 bg-[#5865F2] hover:bg-[#4752C4] text-white px-6 py-3.5 rounded-xl transition-all duration-200 shadow-lg shadow-[#5865F2]/20 font-medium"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 127.14 96.36">
            <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.31,60,73.31,53s5-12.74,11.43-12.74S96.2,46,96.12,53,91.08,65.69,84.69,65.69Z"/>
          </svg>
          <span>Login with Discord</span>
        </button>
      </div>
    </div>
  );
};

export default Login;
