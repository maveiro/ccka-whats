"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import { displayChatName } from "@/lib/chat-display";

const AVATAR_COLORS = [
  "bg-violet-600",
  "bg-blue-600",
  "bg-teal-600",
  "bg-orange-500",
  "bg-pink-600",
  "bg-indigo-600",
  "bg-emerald-600",
  "bg-amber-600",
];

function avatarColor(jid: string): string {
  let hash = 0;
  for (let i = 0; i < jid.length; i++) {
    hash = (hash * 31 + jid.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

interface ChatAvatarProps {
  name: string | null;
  jid: string;
  avatarUrl: string | null;
  size?: number;
}

export default function ChatAvatar({ name, jid, avatarUrl, size = 40 }: ChatAvatarProps) {
  const [errored, setErrored] = useState(false);
  const isGroup = jid.endsWith("@g.us");
  const color = avatarColor(jid);
  const dimension = `${size}px`;

  if (avatarUrl && !errored) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- URL externa e dinâmica (CDN do WhatsApp), sem otimização do Next
      <img
        src={avatarUrl}
        alt=""
        style={{ width: dimension, height: dimension }}
        className="rounded-full object-cover shrink-0"
        onError={() => setErrored(true)}
      />
    );
  }

  if (isGroup) {
    return (
      <div
        style={{ width: dimension, height: dimension }}
        className={`rounded-full ${color} flex items-center justify-center shrink-0`}
        aria-hidden="true"
      >
        <Users size={Math.round(size * 0.45)} className="text-white opacity-90" />
      </div>
    );
  }

  const initial = displayChatName(name, jid).charAt(0).toUpperCase();
  return (
    <div
      style={{ width: dimension, height: dimension }}
      className={`rounded-full ${color} flex items-center justify-center font-bold text-white shrink-0`}
      aria-hidden="true"
    >
      <span style={{ fontSize: Math.round(size * 0.35) }}>{initial}</span>
    </div>
  );
}
