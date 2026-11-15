import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

// publicHome: what a signed-out visitor sees at "/" (the landing page).
// Every other app URL still sends them to /login.
const ProtectedRoute = ({ children, publicHome = null }) => {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();

  // Still checking the sign-in (only reached for a likely signed-out visitor,
  // see AuthContext): the landing page shows meanwhile.
  if (loading && publicHome && pathname === '/') return publicHome;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-gray-800 border-t-indigo-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    if (publicHome && pathname === '/') return publicHome;
    return <Navigate to="/login" replace />;
  }

  return children;
};

export default ProtectedRoute;
