import React, { useEffect, useState, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
  MapPin, 
  Plus, 
  List, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Search, 
  Navigation,
  Clock,
  Camera,
  User as UserIcon,
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, parseISO } from 'date-fns';
import { bn } from 'date-fns/locale';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cn, Post, User, VoteUpdate } from './types';

// Fix Leaflet default icon issue
// Using CDN URLs for icons to avoid build issues with local assets in this environment
const DefaultIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

const getMarkerIcon = (post: Post) => {
  const total = post.true_votes + post.false_votes;
  const trustScore = total > 0 ? (post.true_votes / total) : 0.5;
  
  let color = '#F97316'; // Neutral Orange
  if (total >= 1) { // Require at least 1 vote for color change
    if (trustScore >= 0.7) color = '#10B981'; // Confirmed Green
    if (trustScore <= 0.3) color = '#EF4444'; // Untrusted Red
  }

  return L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background-color: ${color};" class="w-8 h-8 rounded-full border-4 border-white shadow-lg flex items-center justify-center text-white">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
           </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32]
  });
};

const FOOD_ITEMS = [
  { id: 'biriyani', label: 'বিরিয়ানি', color: 'bg-orange-500' },
  { id: 'teheri', label: 'তেহারি', color: 'bg-amber-500' },
  { id: 'khicuri', label: 'খিচুড়ি', color: 'bg-yellow-600' },
  { id: 'normal', label: 'সাধারণ খাবার', color: 'bg-stone-500' },
];

// Mock current user for demo purposes
const MOCK_USER: User = {
  id: 'user_' + Math.random().toString(36).substr(2, 9),
  name: 'Local User',
};

// Component to handle map center updates
function ChangeView({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center);
  }, [center, map]);
  return null;
}

function MapEvents({ onMapClick, isPicking }: { onMapClick: (lat: number, lng: number) => void, isPicking: boolean }) {
  useMapEvents({
    click(e) {
      if (isPicking) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
}

export default function App() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [isSheetExpanded, setIsSheetExpanded] = useState(false);
  const [isPickingLocation, setIsPickingLocation] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tempLocation, setTempLocation] = useState<[number, number] | null>(null);
  
  const socket = React.useRef<Socket | null>(null);

  // Initialize Socket.io
  useEffect(() => {
    socket.current = io();
    
    socket.current.on('post:created', (newPost: Post) => {
      setPosts(prev => [newPost, ...prev]);
    });

    socket.current.on('post:voted', (update: VoteUpdate) => {
      setPosts(prev => prev.map(p => 
        p.id === update.post_id 
          ? { ...p, true_votes: update.true_votes, false_votes: update.false_votes } 
          : p
      ));
    });

    return () => {
      socket.current?.disconnect();
    };
  }, []);

  // Fetch initial posts
  useEffect(() => {
    fetch('/api/posts')
      .then(res => res.json())
      .then(data => setPosts(data));
  }, []);

  // Get user location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation([position.coords.latitude, position.coords.longitude]);
        },
        (error) => {
          console.error('Error getting location:', error);
          setUserLocation([23.9999, 90.4203]); // Default center fallback
        }
      );
    } else {
      setUserLocation([23.9999, 90.4203]); // Default center fallback
    }
  }, []);

  const filteredPosts = useMemo(() => {
    return posts.filter(p => 
      p.place_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [posts, searchQuery]);

  const confirmedCount = posts.filter(p => {
    const total = p.true_votes + p.false_votes;
    return total >= 1 && (p.true_votes / total) >= 0.7;
  }).length;

  const handleVote = async (postId: string, type: 1 | 0) => {
    // Optimistic update
    setPosts(prev => prev.map(p => {
      if (p.id === postId) {
        const isTrue = type === 1;
        return {
          ...p,
          true_votes: isTrue ? p.true_votes + 1 : p.true_votes,
          false_votes: !isTrue ? p.false_votes + 1 : p.false_votes
        };
      }
      return p;
    }));

    await fetch('/api/votes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        post_id: postId,
        user_id: MOCK_USER.id,
        vote_type: type
      })
    });
  };

  const handleAddPost = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const lat = tempLocation ? tempLocation[0] : (userLocation ? userLocation[0] : 23.9999);
    const lng = tempLocation ? tempLocation[1] : (userLocation ? userLocation[1] : 90.4203);

    const newPost = {
      id: 'post_' + Math.random().toString(36).substr(2, 9),
      user_id: MOCK_USER.id,
      place_name: formData.get('place_name') as string,
      description: formData.get('description') as string,
      lat,
      lng,
      distribution_time: formData.get('time') as string || new Date().toISOString(),
    };

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPost)
      });

      if (!response.ok) {
        let errorMessage = 'Failed to add post';
        try {
          const errorData = await response.json();
          errorMessage = errorData.details || errorData.error || errorMessage;
        } catch (e) {
          const text = await response.text().catch(() => '');
          errorMessage = text || errorMessage;
        }
        throw new Error(errorMessage);
      }

      setIsAddModalOpen(false);
      setTempLocation(null);
    } catch (error) {
      console.error('Error adding post:', error);
      alert(`পোস্ট যোগ করতে সমস্যা হয়েছে: ${error instanceof Error ? error.message : 'অজানা সমস্যা'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMapClick = (lat: number, lng: number) => {
    setTempLocation([lat, lng]);
    setIsPickingLocation(false);
    setIsAddModalOpen(true);
  };

  const selectedPost = useMemo(() => 
    posts.find(p => p.id === selectedPostId) || null
  , [posts, selectedPostId]);

  if (!userLocation) {
    return (
      <div className="h-screen flex items-center justify-center bg-green-800 text-white">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="font-bold">লোডিং হচ্ছে...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#F3F4F6] font-sans text-stone-900 overflow-hidden">
      {/* Header */}
      <header className="bg-white px-4 py-3 flex items-center gap-2 z-[1000] shadow-sm">
        <button 
          onClick={() => window.location.reload()}
          className="flex items-center gap-1.5 px-3 py-2 bg-white border border-stone-200 rounded-xl shadow-sm active:scale-95 transition-transform"
        >
          <div className="w-6 h-6 bg-orange-500 rounded-md flex items-center justify-center">
             <img src="https://picsum.photos/seed/food/32/32" className="w-4 h-4 rounded-sm" referrerPolicy="no-referrer" />
          </div>
          <span className="text-[13px] font-bold text-green-800 leading-tight text-left">বিরিয়ানি দিবে</span>
        </button>

        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input 
            type="text" 
            placeholder="মসজিদ বা এলাকা খুঁজুন..." 
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 shadow-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </header>

      {/* Stats Bar */}
      <div className="px-4 py-2 flex items-center justify-between z-[999] bg-transparent">
        <div className="flex gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 text-white rounded-full text-[11px] font-bold shadow-sm">
            <span className="w-2 h-2 bg-orange-400 rounded-full animate-pulse"></span>
            সর্বমোট স্পট: {posts.length}টি
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-green-700 border border-green-100 rounded-full text-[11px] font-bold shadow-sm">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
            নিশ্চিত: {confirmedCount}টি
          </div>
        </div>
      </div>

      {/* Main Content - Leaflet Map */}
      <main className="flex-1 relative">
        <MapContainer 
          center={userLocation} 
          zoom={13} 
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
        >
          <ChangeView center={userLocation} />
          <MapEvents onMapClick={handleMapClick} isPicking={isPickingLocation} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {posts.map(post => (
            <Marker 
              key={post.id} 
              position={[post.lat, post.lng]}
              icon={getMarkerIcon(post)}
              eventHandlers={{
                click: () => setSelectedPostId(post.id),
              }}
            />
          ))}
        </MapContainer>

        {/* Picking Mode Overlay */}
        <AnimatePresence>
          {isPickingLocation && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="absolute top-6 left-1/2 -translate-x-1/2 bg-green-800 text-white px-6 py-3 rounded-2xl shadow-2xl z-[1001] flex items-center gap-3 border-2 border-white/20"
            >
              <MapPin className="w-5 h-5 text-orange-400 animate-bounce" />
              <span className="text-sm font-bold">ম্যাপে লোকেশন সিলেক্ট করুন</span>
              <button 
                onClick={() => setIsPickingLocation(false)}
                className="ml-2 p-1 hover:bg-white/10 rounded-full"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Floating Action Button */}
        <button 
          disabled={isLocating}
          onClick={() => {
            if (isPickingLocation) {
              setIsPickingLocation(false);
              return;
            }

            setIsLocating(true);
            if (navigator.geolocation) {
              navigator.geolocation.getCurrentPosition(
                (pos) => {
                  setIsLocating(false);
                  setTempLocation([pos.coords.latitude, pos.coords.longitude]);
                  setIsAddModalOpen(true);
                },
                () => {
                  setIsLocating(false);
                  setIsPickingLocation(true);
                },
                { timeout: 5000 }
              );
            } else {
              setIsLocating(false);
              setIsPickingLocation(true);
            }
          }}
          className={cn(
            "absolute bottom-32 right-6 w-16 h-16 rounded-full shadow-xl flex items-center justify-center transition-all active:scale-95 z-[1000] border-4 border-white/20",
            isPickingLocation ? "bg-rose-500 hover:bg-rose-600 rotate-45" : "bg-orange-500 hover:bg-orange-600",
            isLocating && "animate-pulse opacity-80 cursor-wait"
          )}
        >
          {isLocating ? (
            <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Plus className="w-10 h-10 text-white" />
          )}
        </button>

        {/* Bottom Sheet Panel */}
        <motion.div 
          animate={{ height: isSheetExpanded ? 'auto' : '60px' }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="absolute bottom-0 left-0 right-0 bg-green-800 rounded-t-[32px] shadow-2xl z-[1000] flex flex-col overflow-hidden"
        >
          <div 
            onClick={() => setIsSheetExpanded(!isSheetExpanded)}
            className="flex items-center justify-between px-6 py-4 cursor-pointer active:bg-green-700/50 transition-colors"
          >
            <div className="flex items-center gap-2 text-white">
              <span className="w-2 h-2 bg-orange-400 rounded-full"></span>
              <h2 className="text-sm font-bold">আজকের সক্রিয় স্পট</h2>
            </div>
            <div className="flex items-center gap-1 text-green-200 text-xs font-bold">
              {posts.length}টি সরাসরি
              {isSheetExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </div>
          </div>
          
          <div className="flex-1 overflow-x-auto px-4 pb-6 flex gap-4 no-scrollbar min-h-[160px]">
            {filteredPosts.length > 0 ? (
              filteredPosts.map(post => (
                <div key={post.id} className="min-w-[280px]">
                  <PostCard 
                    post={post} 
                    onVote={handleVote}
                    onClick={() => setSelectedPostId(post.id)}
                  />
                </div>
              ))
            ) : (
              <div className="w-full py-10 text-center text-green-200/50 text-sm">
                কোন স্পট পাওয়া যায়নি
              </div>
            )}
          </div>
        </motion.div>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {isAddModalOpen && (
          <AddPostModal 
            onClose={() => {
              setIsAddModalOpen(false);
              setTempLocation(null);
            }} 
            onSubmit={handleAddPost}
            tempLocation={tempLocation}
            isSubmitting={isSubmitting}
          />
        )}
        {selectedPost && (
          <PostDetailModal 
            post={selectedPost} 
            onClose={() => setSelectedPostId(null)}
            onVote={handleVote}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function PostCard({ post, onVote, onClick }: { post: Post, onVote: (id: string, type: 1 | 0) => void, onClick: () => void }) {
  return (
    <motion.div 
      layout
      className="bg-white rounded-2xl p-4 shadow-lg flex flex-col gap-3 relative overflow-hidden"
      onClick={onClick}
    >
      <div className="flex gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-stone-900 truncate text-base">{post.place_name}</h3>
            {post.true_votes + post.false_votes > 0 && (post.true_votes / (post.true_votes + post.false_votes)) >= 0.7 && (
              <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-[9px] font-black rounded uppercase tracking-wider">নিশ্চিত</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <div className="flex items-center gap-1 text-[11px] text-stone-500 font-medium">
              <MapPin className="w-3 h-3 text-stone-400" />
              {post.lat.toFixed(2)}, {post.lng.toFixed(2)}
            </div>
            <div className="flex items-center gap-1 text-[11px] text-stone-500 font-medium">
              <Clock className="w-3 h-3 text-stone-400" />
              এইমাত্র
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-1">
        <div className="flex items-center gap-1 px-2.5 py-1 bg-green-50 text-green-700 rounded-lg text-[11px] font-bold border border-green-100">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {post.true_votes} সত্যি
        </div>
        <div className="flex items-center gap-1 px-2.5 py-1 bg-rose-50 text-rose-700 rounded-lg text-[11px] font-bold border border-rose-100">
          <XCircle className="w-3.5 h-3.5" />
          {post.false_votes} ভুয়া
        </div>
        <div className="ml-auto text-[11px] font-bold text-orange-600">
          {FOOD_ITEMS.find(f => f.id === post.description)?.label || post.description}
        </div>
      </div>
    </motion.div>
  );
}

function AddPostModal({ onClose, onSubmit, tempLocation, isSubmitting }: { onClose: () => void, onSubmit: (e: React.FormEvent<HTMLFormElement>) => void, tempLocation: [number, number] | null, isSubmitting: boolean }) {
  return (
    <div className="fixed inset-0 z-[2000] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        className="relative w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl overflow-y-auto max-h-[95vh] shadow-2xl"
      >
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-green-800">নতুন স্পট যোগ করুন</h2>
            <button onClick={onClose} className="p-2 hover:bg-stone-100 rounded-full">
              <XCircle className="w-6 h-6 text-stone-400" />
            </button>
          </div>

          {tempLocation && (
            <div className="mb-4 p-3 bg-orange-50 border border-orange-100 rounded-xl flex items-center gap-2">
              <MapPin className="w-4 h-4 text-orange-500" />
              <span className="text-xs font-bold text-orange-700">
                নির্বাচিত লোকেশন: {tempLocation[0].toFixed(4)}, {tempLocation[1].toFixed(4)}
              </span>
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-stone-500 uppercase mb-1.5">মসজিদ বা এলাকার নাম</label>
              <input 
                name="place_name" 
                required 
                placeholder="যেমন: জয়দেবপুর স্টেশন" 
                className="w-full px-4 py-3 bg-stone-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/20"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-500 uppercase mb-2.5">খাবারের ধরন</label>
              <div className="grid grid-cols-2 gap-2">
                {FOOD_ITEMS.map((item) => (
                  <label key={item.id} className="relative cursor-pointer group">
                    <input 
                      type="radio" 
                      name="description" 
                      value={item.id} 
                      className="peer sr-only" 
                      required
                      defaultChecked={item.id === 'biriyani'}
                    />
                    <div className="px-4 py-3 bg-stone-100 rounded-xl border-2 border-transparent peer-checked:border-green-600 peer-checked:bg-green-50 transition-all text-center">
                      <span className="text-sm font-bold text-stone-700 peer-checked:text-green-800">{item.label}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-xs font-bold text-stone-500 uppercase mb-1.5">সময়</label>
                <input 
                  name="time" 
                  type="datetime-local" 
                  required 
                  defaultValue={new Date().toLocaleString('sv-SE').replace(' ', 'T').slice(0, 16)}
                  className="w-full px-4 py-3 bg-stone-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/20 text-sm"
                />
              </div>
            </div>
            <button 
              type="submit" 
              disabled={isSubmitting}
              className="w-full py-4 bg-green-700 text-white rounded-2xl font-bold text-lg shadow-lg shadow-green-700/20 hover:bg-green-800 active:scale-[0.98] transition-all mt-4 mb-8 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'প্রসেসিং হচ্ছে...' : 'পোস্ট করুন'}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}

function PostDetailModal({ post, onClose, onVote }: { post: Post, onClose: () => void, onVote: (id: string, type: 1 | 0) => void }) {
  const trustScore = post.true_votes + post.false_votes > 0 
    ? Math.round((post.true_votes / (post.true_votes + post.false_votes)) * 100)
    : 0;

  return (
    <div className="fixed inset-0 z-[2000] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        className="relative w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl overflow-y-auto max-h-[95vh] shadow-2xl"
      >
        <div className="p-6">
          <div className="flex justify-between items-start mb-6">
            <div>
              <div className={cn(
                "inline-block px-3 py-1 rounded-full text-[10px] font-black uppercase mb-2",
                trustScore >= 70 ? "bg-emerald-100 text-emerald-700" : 
                trustScore >= 40 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"
              )}>
                {trustScore}% কমিউনিটি বিশ্বাস
              </div>
              <h2 className="text-2xl font-bold text-green-900">{post.place_name}</h2>
              <p className="text-stone-500 flex items-center gap-1 text-sm">
                <MapPin className="w-3.5 h-3.5" /> বাংলাদেশ
              </p>
            </div>
            <div className="flex gap-2">
              <button className="p-3 bg-orange-100 text-orange-600 rounded-2xl">
                <Navigation className="w-6 h-6" />
              </button>
              <button 
                onClick={onClose} 
                className="p-3 bg-stone-100 text-stone-400 hover:text-stone-600 rounded-2xl transition-colors"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>
          </div>
          
          <div className="bg-stone-50 rounded-2xl p-4 mb-6">
            <h3 className="text-xs font-bold text-stone-400 uppercase mb-2">খাবারের ধরন</h3>
            <div className="flex items-center gap-2">
              <div className={cn(
                "w-3 h-3 rounded-full",
                FOOD_ITEMS.find(f => f.id === post.description)?.color || "bg-stone-400"
              )} />
              <p className="text-lg font-bold text-stone-800">
                {FOOD_ITEMS.find(f => f.id === post.description)?.label || post.description}
              </p>
            </div>
            <div className="mt-4 flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm text-stone-600">
                <Clock className="w-4 h-4 text-orange-500" />
                <span className="font-medium">{format(parseISO(post.distribution_time), 'MMMM d, h:mm a', { locale: bn })}</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-bold text-stone-900 text-center">এই তথ্যটি কি সঠিক?</h3>
            <div className="flex gap-3">
              <button 
                onClick={() => onVote(post.id, 1)}
                className="flex-1 py-4 bg-green-50 text-green-700 rounded-2xl font-bold flex flex-col items-center gap-1 border-2 border-transparent active:border-green-500 transition-all"
              >
                <CheckCircle2 className="w-6 h-6" />
                <span>সঠিক ({post.true_votes})</span>
              </button>
              <button 
                onClick={() => onVote(post.id, 0)}
                className="flex-1 py-4 bg-rose-50 text-rose-700 rounded-2xl font-bold flex flex-col items-center gap-1 border-2 border-transparent active:border-rose-500 transition-all"
              >
                <XCircle className="w-6 h-6" />
                <span> ভুল({post.false_votes})</span>
              </button>
            </div>
            <button className="w-full py-3 text-stone-400 text-sm font-medium flex items-center justify-center gap-2 hover:text-rose-500 transition-colors">
              <AlertTriangle className="w-4 h-4" />
              ভুল তথ্য রিপোর্ট করুন
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
