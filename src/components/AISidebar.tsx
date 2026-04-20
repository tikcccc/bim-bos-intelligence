
import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, X, Send, Bot, User, ChevronRight, Command, MessageSquare, AlertCircle } from 'lucide-react';
import { UserContext, ConversationMemory, ProactiveAlert } from '../types/ai';

interface AISidebarProps {
  isOpen: boolean;
  onClose: () => void;
  userContext: UserContext;
  onSendMessage: (msg: string) => Promise<void>;
  alerts: ProactiveAlert[];
  memory: ConversationMemory;
}

export const AISidebar: React.FC<AISidebarProps> = ({ 
  isOpen, 
  onClose, 
  userContext, 
  onSendMessage,
  alerts,
  memory
}) => {
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [memory.history]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const msg = input;
    sendChatMessage(msg);
  };

  const sendChatMessage = async (msg: string) => {
    setInput('');
    setIsTyping(true);
    await onSendMessage(msg);
    setIsTyping(false);
  };

  const QUICK_ACTIONS = [
    { label: "Search Accounts", prompt: "Search for accounts in the construction industry" },
    { label: "Create Task", prompt: "Create a task to review the new project tender by Friday" },
    { label: "Add Account", prompt: "Register a new strategic account named 'Skyline Build'" },
    { label: "Analyze Tender", prompt: "Help me analyze a new tender document" }
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/20 backdrop-blur-[2px] z-[60]"
          />

          {/* Sidebar Area */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 h-full w-[400px] bg-white shadow-2xl z-[70] flex flex-col border-l border-[#EAECF0]"
          >
            {/* Header */}
            <div className="p-6 border-b border-[#EAECF0] bg-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#F9F5FF] rounded-xl flex items-center justify-center">
                  <Bot className="w-5 h-5 text-[#7F56D9]" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-[#101828]">BOS Chatbot</h3>
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 bg-[#12B76A] rounded-full" />
                    <span className="text-[10px] font-bold text-[#667085] uppercase tracking-wider">
                      Module Integrations Enabled • {userContext.role}
                    </span>
                  </div>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 text-[#667085] hover:bg-[#F9FAFB] rounded-lg transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content: Alerts & Chat */}
            <div className="flex-1 overflow-hidden flex flex-col bg-[#F9FAFB]">
              
              {/* Proactive Alerts Section */}
              {alerts.length > 0 && (
                <div className="p-4 pb-0">
                  <div className="flex items-center gap-2 mb-2 px-2">
                    <AlertCircle className="w-3 h-3 text-[#7F56D9]" />
                    <span className="text-[10px] font-bold text-[#475467] uppercase tracking-widest">Priority Insights</span>
                  </div>
                  <div className="flex gap-3 overflow-x-auto pb-4 px-2 no-scrollbar">
                    {alerts.slice(0, 3).map((alert) => (
                      <motion.div 
                        key={alert.id}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="min-w-[280px] bg-white border border-[#EAECF0] p-3 rounded-xl shadow-sm hover:border-[#7F56D9] transition-all cursor-pointer shrink-0"
                      >
                         <h5 className="text-xs font-bold text-[#101828] mb-1 line-clamp-1">{alert.title}</h5>
                         <p className="text-[10px] text-[#475467] line-clamp-2">{alert.body}</p>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              <div className="px-6 py-2">
                <div className="h-px bg-[#EAECF0] w-full" />
              </div>

              {/* Chat History */}
              <div 
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-6 space-y-6 py-4 scroll-smooth"
              >
                {memory.history.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center px-4">
                    <div className="w-16 h-16 bg-white border border-[#EAECF0] rounded-2xl flex items-center justify-center mb-4 shadow-sm">
                      <Sparkles className="w-8 h-8 text-[#D0D5DD]" />
                    </div>
                    <p className="text-sm font-bold text-[#101828] mb-1">Hello, I'm your BOS Assistant</p>
                    <p className="text-xs text-[#667085] mb-8">I can help you create tasks, find client data, and move files across modules.</p>
                    
                    <div className="grid grid-cols-2 gap-3 w-full">
                      {QUICK_ACTIONS.map((action, i) => (
                        <button
                          key={i}
                          onClick={() => sendChatMessage(action.prompt)}
                          className="p-3 bg-white border border-[#EAECF0] rounded-xl text-left hover:border-[#7F56D9] hover:bg-[#F9F5FF] transition-all group"
                        >
                          <p className="text-[10px] font-bold text-[#101828] group-hover:text-[#7F56D9]">{action.label}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                
                {memory.history.map((msg, i) => (
                  <div 
                    key={i}
                    className={`flex gap-3 ${msg.role === 'model' ? '' : 'flex-row-reverse'}`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center ${
                      msg.role === 'model' ? 'bg-[#F9F5FF] text-[#7F56D9]' : 'bg-[#101828] text-white'
                    }`}>
                      {msg.role === 'model' ? <Bot className="w-5 h-5" /> : <User className="w-5 h-5" />}
                    </div>
                    <div className={`max-w-[85%] space-y-1 ${msg.role === 'model' ? '' : 'items-end'}`}>
                      <div className={`p-4 rounded-2xl text-sm leading-relaxed ${
                        msg.role === 'model' 
                          ? 'bg-white border border-[#EAECF0] text-[#344054] shadow-sm' 
                          : 'bg-[#7F56D9] text-white shadow-md shadow-purple-100'
                      }`}>
                        {msg.content}
                      </div>
                      <span className="text-[10px] text-[#98A2B3] px-1 font-medium">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ))}
                {isTyping && (
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-lg bg-[#F9F5FF] text-[#7F56D9] flex items-center justify-center">
                      <Bot className="w-5 h-5 animate-pulse" />
                    </div>
                    <div className="bg-white border border-[#EAECF0] p-3 rounded-2xl flex gap-1">
                      <span className="w-1.5 h-1.5 bg-[#D0D5DD] rounded-full animate-bounce" />
                      <span className="w-1.5 h-1.5 bg-[#D0D5DD] rounded-full animate-bounce [animation-delay:0.2s]" />
                      <span className="w-1.5 h-1.5 bg-[#D0D5DD] rounded-full animate-bounce [animation-delay:0.4s]" />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Input Footer */}
            <div className="p-6 bg-white border-t border-[#EAECF0]">
              <form 
                onSubmit={handleSubmit}
                className="relative"
              >
                <textarea
                  value={input || ''}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                  placeholder="Ask BOS anything..."
                  className="w-full pl-4 pr-12 py-3 bg-[#F9FAFB] border border-[#D0D5DD] rounded-xl text-sm focus:ring-2 focus:ring-[#F4EBFF] focus:border-[#7F56D9] outline-none transition-all resize-none h-12"
                />
                <button 
                  type="submit"
                  disabled={!input.trim() || isTyping}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-[#7F56D9] text-white rounded-lg hover:bg-[#6941C6] disabled:opacity-50 transition-all"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
              <div className="mt-3 flex items-center justify-between text-[10px] text-[#98A2B3] font-medium uppercase tracking-widest px-1">
                <span className="flex items-center gap-1">
                  <Command className="w-3 h-3" /> K for palette
                </span>
                <span>Gemini 3.1 Orchestration</span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
