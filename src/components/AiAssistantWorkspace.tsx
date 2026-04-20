
import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Send, Bot, User, ChevronRight, Command, MessageSquare, AlertCircle, Search, Settings, ArrowRight } from 'lucide-react';
import { UserContext, ConversationMemory, ProactiveAlert } from '../types/ai';

interface AiAssistantWorkspaceProps {
  userContext: UserContext;
  onSendMessage: (msg: string) => Promise<void>;
  alerts: ProactiveAlert[];
  memory: ConversationMemory;
}

export const AiAssistantWorkspace: React.FC<AiAssistantWorkspaceProps> = ({ 
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

  const sendChatMessage = async (msg: string) => {
    if (!msg.trim()) return;
    setInput('');
    setIsTyping(true);
    await onSendMessage(msg);
    setIsTyping(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendChatMessage(input);
  };

  const QUICK_ACTIONS = [
    { label: "Search Accounts", description: "Find clients by industry or region", prompt: "Search for accounts in the construction industry" },
    { label: "Create Action Item", description: "Generate a new task or reminder", prompt: "Create a task to review the new project tender by Friday" },
    { label: "Register Account", description: "Add a new strategic partner", prompt: "Register a new strategic account named 'Skyline Build'" },
    { label: "Bid Intelligence", description: "Analyze complex tender documents", prompt: "Help me analyze a new tender document" }
  ];

  return (
    <div className="flex-1 flex flex-col h-full bg-[#F9FAFB]">
      <div className="max-w-6xl mx-auto w-full flex-1 flex flex-col overflow-hidden bg-white border-x border-[#EAECF0]">
        {/* Header */}
        <div className="px-8 py-6 border-b border-[#EAECF0] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-[#F9F5FF] rounded-2xl flex items-center justify-center shadow-sm">
              <Bot className="w-6 h-6 text-[#7F56D9]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[#101828]">BOS AI Workspace</h2>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 bg-[#12B76A] rounded-full" />
                  <span className="text-xs font-bold text-[#667085] uppercase tracking-wider">Systems Integrated</span>
                </span>
                <span className="text-[#D0D5DD]">•</span>
                <span className="text-xs font-medium text-[#667085]">Role: {userContext.role}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
             <button className="p-2 text-[#667085] hover:bg-[#F9FAFB] rounded-lg transition-all">
                <Settings className="w-5 h-5" />
             </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* Main Chat Flow */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-8 py-8 space-y-8 scroll-smooth"
            >
              {memory.history.length === 0 ? (
                <div className="max-w-3xl mx-auto pt-12 text-center">
                  <div className="w-20 h-20 bg-[#F9F5FF] rounded-3xl flex items-center justify-center mx-auto mb-8 animate-pulse shadow-sm">
                    <Sparkles className="w-10 h-10 text-[#7F56D9]" />
                  </div>
                  <h1 className="text-3xl font-bold text-[#101828] mb-4">Good morning. How can I assist you?</h1>
                  <p className="text-[#667085] text-lg mb-12 max-w-xl mx-auto">I'm your intelligent platform assistant. I can automate data entry, search through your organizational records, and perform actions across modules.</p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
                    {QUICK_ACTIONS.map((action, i) => (
                      <button
                        key={i}
                        onClick={() => sendChatMessage(action.prompt)}
                        className="p-6 bg-white border border-[#EAECF0] rounded-2xl hover:border-[#7F56D9] hover:shadow-lg hover:shadow-purple-50 transition-all group text-left flex flex-col justify-between h-40"
                      >
                        <div>
                          <div className="w-10 h-10 bg-[#F9FAFB] rounded-xl flex items-center justify-center mb-4 group-hover:bg-[#F9F5FF] transition-colors">
                             <ArrowRight className="w-5 h-5 text-[#98A2B3] group-hover:text-[#7F56D9]" />
                          </div>
                          <h3 className="font-bold text-[#101828] mb-1">{action.label}</h3>
                          <p className="text-sm text-[#667085]">{action.description}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="max-w-4xl mx-auto w-full space-y-8 pb-12">
                  {memory.history.map((msg, i) => (
                    <motion.div 
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex gap-6 ${msg.role === 'model' ? '' : 'flex-row-reverse'}`}
                    >
                      <div className={`w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center shadow-sm ${
                        msg.role === 'model' ? 'bg-[#F9F5FF] text-[#7F56D9]' : 'bg-[#101828] text-white'
                      }`}>
                        {msg.role === 'model' ? <Bot className="w-6 h-6" /> : <User className="w-6 h-6" />}
                      </div>
                      <div className={`max-w-[80%] space-y-2 ${msg.role === 'model' ? '' : 'items-end'}`}>
                        <div className={`p-5 rounded-2xl text-base leading-relaxed shadow-sm ${
                          msg.role === 'model' 
                            ? 'bg-[#F9FAFB] border border-[#EAECF0] text-[#344054]' 
                            : 'bg-[#7F56D9] text-white shadow-md shadow-purple-50'
                        }`}>
                          {msg.content}
                        </div>
                        <span className="text-xs text-[#98A2B3] px-2 font-medium">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                  {isTyping && (
                    <div className="flex gap-6">
                      <div className="w-10 h-10 rounded-xl bg-[#F9F5FF] text-[#7F56D9] flex items-center justify-center shadow-sm">
                        <Bot className="w-6 h-6 animate-pulse" />
                      </div>
                      <div className="bg-[#F9FAFB] border border-[#EAECF0] p-4 rounded-2xl flex gap-1.5 items-center">
                        <span className="w-1.5 h-1.5 bg-[#D0D5DD] rounded-full animate-bounce" />
                        <span className="w-1.5 h-1.5 bg-[#D0D5DD] rounded-full animate-bounce [animation-delay:0.2s]" />
                        <span className="w-1.5 h-1.5 bg-[#D0D5DD] rounded-full animate-bounce [animation-delay:0.4s]" />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Input Bar */}
            <div className="px-8 py-8 bg-white border-t border-[#EAECF0] shrink-0">
               <div className="max-w-4xl mx-auto relative group">
                  <form onSubmit={handleSubmit} className="relative">
                    <textarea
                      value={input || ''}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSubmit(e);
                        }
                      }}
                      placeholder="Type a command or ask a question..."
                      className="w-full pl-6 pr-16 py-5 bg-[#F9FAFB] border border-[#D0D5DD] rounded-2xl text-base focus:ring-4 focus:ring-[#F4EBFF] focus:border-[#7F56D9] outline-none transition-all resize-none h-20 group-hover:border-[#7F56D9]"
                    />
                    <button 
                      type="submit"
                      disabled={!input.trim() || isTyping}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-3 bg-[#7F56D9] text-white rounded-xl hover:bg-[#6941C6] disabled:opacity-50 transition-all shadow-md shadow-purple-100"
                    >
                      <Send className="w-5 h-5" />
                    </button>
                  </form>
                  <div className="mt-4 flex items-center justify-between text-xs text-[#98A2B3] font-medium uppercase tracking-widest px-2">
                    <div className="flex items-center gap-4">
                      <span className="flex items-center gap-1.5">
                        <Command className="w-3.5 h-3.5" /> K for Palette
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Search className="w-3.5 h-3.5" /> Direct Search Control
                      </span>
                    </div>
                    <span>Gemini • Orchestrated Intelligence</span>
                  </div>
               </div>
            </div>
          </div>

          {/* Right Sidebar: Context & Alerts */}
          <div className="w-80 border-l border-[#EAECF0] bg-[#F9FAFB] overflow-y-auto p-6 space-y-8 hidden xl:block shrink-0">
             <div>
                <h4 className="text-[10px] font-bold text-[#98A2B3] uppercase tracking-widest mb-4">Pinned Insights</h4>
                <div className="space-y-4">
                  {alerts.map((alert) => (
                    <div key={alert.id} className="bg-white border border-[#EAECF0] p-4 rounded-xl shadow-sm hover:border-[#7F56D9] transition-all cursor-pointer">
                       <h5 className="text-sm font-bold text-[#101828] mb-1">{alert.title}</h5>
                       <p className="text-xs text-[#667085] line-clamp-2 mb-3">{alert.body}</p>
                       <div className="flex items-center justify-between text-[10px] font-bold">
                          <span className={`${alert.priority >= 4 ? 'text-[#B42318]' : 'text-[#7F56D9]'}`}>P{alert.priority} PRIORITY</span>
                          <span className="text-[#98A2B3]">{new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                       </div>
                    </div>
                  ))}
                </div>
             </div>

             <div>
                <h4 className="text-[10px] font-bold text-[#98A2B3] uppercase tracking-widest mb-4">Conversation Parameters</h4>
                <div className="space-y-3">
                   <div className="flex items-center justify-between p-3 bg-white border border-[#EAECF0] rounded-xl text-xs">
                      <span className="text-[#667085]">Data Isolation</span>
                      <span className="font-bold text-[#12B76A]">ACTIVE</span>
                   </div>
                   <div className="flex items-center justify-between p-3 bg-white border border-[#EAECF0] rounded-xl text-xs">
                      <span className="text-[#667085]">Audit Logging</span>
                      <span className="font-bold text-[#7F56D9]">ENABLED</span>
                   </div>
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};
