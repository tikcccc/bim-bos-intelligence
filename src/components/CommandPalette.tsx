
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Command as CommandIcon, Mail, Folder, Layout, FileText, Settings, User, AlertCircle, Sparkles, ChevronRight } from 'lucide-react';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onAction: (action: string) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, onAction }) => {
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
        else setQuery(''); // Clear on open
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const actions = [
    { id: 'goto-inbox', label: 'Go to Inbox', icon: <Mail className="w-4 h-4" />, category: 'Navigation', shortcut: ['G', 'I'] },
    { id: 'goto-tenders', label: 'Go to Tenders', icon: <Folder className="w-4 h-4" />, category: 'Navigation' },
    { id: 'goto-meetings', label: 'Go to Meetings', icon: <Layout className="w-4 h-4" />, category: 'Navigation', shortcut: ['G', 'M'] },
    { id: 'new-quote', label: 'Create New Quote', icon: <FileText className="w-4 h-4" />, category: 'Actions', shortcut: ['N', 'Q'] },
    { id: 'ai-summary', label: 'AI Daily Summary', icon: <Sparkles className="w-4 h-4" />, category: 'AI', shortcut: ['S'] },
    { id: 'analyze-meeting', label: 'Analyze Current Transcript', icon: <Sparkles className="w-4 h-4" />, category: 'AI' },
    { id: 'settings', label: 'Open Settings', icon: <Settings className="w-4 h-4" />, category: 'System' },
  ];

  const filteredActions = actions.filter(action => 
    action.label.toLowerCase().includes(query.toLowerCase()) || 
    action.category.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#0C111D]/60 backdrop-blur-sm"
            onClick={onClose}
          />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-[#EAECF0] overflow-hidden relative z-[101]"
          >
            {/* Search Bar */}
            <div className="flex items-center px-6 py-5 border-b border-[#EAECF0]">
              <Search className="w-5 h-5 text-[#667085] mr-4" />
              <input 
                autoFocus
                type="text"
                placeholder="Type a command or search..."
                value={query || ''}
                onChange={(e) => setQuery(e.target.value)}
                className="flex-1 bg-transparent border-none outline-none text-lg text-[#101828] placeholder:text-[#98A2B3]"
              />
              <div className="flex items-center gap-1 px-2 py-1 bg-[#F9FAFB] border border-[#EAECF0] rounded-lg">
                <span className="text-[10px] font-bold text-[#667085]">ESC</span>
              </div>
            </div>

            {/* Results */}
            <div className="max-h-[60vh] overflow-y-auto py-3">
              {filteredActions.length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <div className="w-12 h-12 bg-[#F9FAFB] rounded-xl flex items-center justify-center mx-auto mb-4">
                    <AlertCircle className="w-6 h-6 text-[#D0D5DD]" />
                  </div>
                  <p className="text-sm font-medium text-[#475467]">No results found for "{query}"</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Groups */}
                  {Array.from(new Set(filteredActions.map(a => a.category))).map(category => (
                    <div key={category}>
                      <div className="px-6 py-2">
                        <span className="text-[10px] font-bold text-[#98A2B3] uppercase tracking-[0.15em]">{category}</span>
                      </div>
                      <div className="px-3">
                        {filteredActions.filter(a => a.category === category).map(action => (
                          <button
                            key={action.id}
                            onClick={() => {
                              onAction(action.id);
                              onClose();
                            }}
                            className="w-full flex items-center justify-between px-3 py-3 hover:bg-[#F9F5FF] rounded-xl transition-all group"
                          >
                            <div className="flex items-center gap-4">
                              <div className="p-2 bg-[#F9FAFB] border border-[#EAECF0] rounded-lg group-hover:border-[#D6BBFB] group-hover:bg-white text-[#667085] group-hover:text-[#7F56D9] transition-all">
                                {action.icon}
                              </div>
                              <span className="text-sm font-bold text-[#344054] group-hover:text-[#101828]">{action.label}</span>
                            </div>
                            {action.shortcut && (
                              <div className="flex gap-1">
                                {action.shortcut.map(s => (
                                  <span key={s} className="min-w-[20px] px-1.5 py-1 bg-[#F9FAFB] border border-[#EAECF0] rounded text-[10px] font-bold text-[#667085] uppercase">
                                    {s}
                                  </span>
                                ))}
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-[#F9FAFB] border-t border-[#EAECF0] flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <div className="p-1 px-1.5 bg-white border border-[#EAECF0] rounded shadow-sm">
                    <ChevronRight className="w-3 h-3 text-[#667085] rotate-90" />
                  </div>
                  <span className="text-[10px] font-bold text-[#667085] uppercase tracking-wider">Navigate</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="px-1.5 py-1 bg-white border border-[#EAECF0] rounded shadow-sm text-[10px] font-bold text-[#667085]">
                    ↵
                  </div>
                  <span className="text-[10px] font-bold text-[#667085] uppercase tracking-wider">Select</span>
                </div>
              </div>
              <div className="flex items-center gap-2 opacity-50">
                <CommandIcon className="w-3.5 h-3.5 text-[#667085]" />
                <span className="text-[10px] font-bold text-[#667085] uppercase tracking-widest">BOS Command</span>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
