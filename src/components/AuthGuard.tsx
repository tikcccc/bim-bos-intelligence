import React, { useEffect, useState } from 'react';
import { auth, googleProvider } from '../lib/firebase';
import { signInWithPopup, onAuthStateChanged, User } from 'firebase/auth';
import { LogIn, Mail } from 'lucide-react';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-[#7F56D9] rounded-xl flex items-center justify-center shadow-lg shadow-purple-100">
            <Mail className="text-white w-6 h-6" />
          </div>
          <p className="text-sm font-medium text-[#475467]">Initializing System...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-[#EAECF0] p-10 rounded-2xl shadow-xl shadow-gray-200/50">
          <div className="flex flex-col items-center text-center mb-8">
            <div className="w-14 h-14 bg-[#F9F5FF] rounded-2xl flex items-center justify-center mb-6">
              <Mail className="text-[#7F56D9] w-8 h-8" />
            </div>
            <h1 className="text-3xl font-bold text-[#101828] tracking-tight mb-2">isBIM BOS</h1>
            <p className="text-sm text-[#475467]">Email & Classification</p>
          </div>
          
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-lg font-semibold text-[#101828] mb-2">Restricted Access</h2>
              <p className="text-sm text-[#475467] leading-relaxed">
                This module is reserved for authorized sales agents. Please authenticate with your corporate Google account.
              </p>
            </div>
            
            <button
              onClick={handleLogin}
              className="w-full flex items-center justify-center gap-3 bg-[#7F56D9] text-white py-3 px-6 rounded-lg font-semibold hover:bg-[#6941C6] transition-all shadow-sm shadow-purple-200"
            >
              <LogIn className="w-5 h-5" />
              Sign in with Google
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
