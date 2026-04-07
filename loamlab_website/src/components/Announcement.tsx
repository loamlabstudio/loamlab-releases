"use client";

import React, { useState, useEffect } from 'react';

export default function Announcement() {
  const [text, setText] = useState("");
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // 每次載入時，從後端動態拉取管理者設定的緊急公告
    fetch('https://loamlab-camera.vercel.app/api/stats?action=get_announcement')
      .then(r => r.json())
      .then(d => {
        if (d.code === 0 && d.announcement) {
          setText(d.announcement);
          setIsVisible(true);
        }
      })
      .catch(e => console.error('Failed to fetch announcement:', e));
  }, []);

  if (!isVisible || !text) return null;

  return (
    <div className="bg-yellow-500/90 text-black px-4 py-3 text-sm font-bold flex items-center justify-between border-b border-yellow-600/50 relative z-50">
      <div className="flex-1 text-center pr-6">
        {text}
      </div>
      <button 
        onClick={() => setIsVisible(false)}
        className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-black/10 transition-colors text-black/70 hover:text-black absolute right-3"
        aria-label="關閉公告"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  );
}
