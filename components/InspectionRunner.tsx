import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Site, InspectionLog, Answer, InspectionDraft } from '../types';
import { Camera, Check, X, ChevronRight, MessageSquare, RotateCcw, User, Cloud, HardDrive } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { db } from '../services/db';
import { storageService } from '../services/storageService';
import { checkSupabaseConfig } from '../services/supabaseClient';

interface Props {
  site: Site;
  initialDraft?: InspectionDraft | null; // Optional draft to resume
  onComplete: (log: InspectionLog) => void;
  onCancel: () => void;
}

const compressImage = (base64Str: string, maxWidth = 1024, quality = 0.6): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
      } else {
          resolve(base64Str);
      }
    };
    img.onerror = () => resolve(base64Str);
  });
};

export const InspectionRunner: React.FC<Props> = ({ site, initialDraft, onComplete, onCancel }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [storageEstimate, setStorageEstimate] = useState<number | null>(null);

  useEffect(() => {
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(estimate => {
        if (estimate.quota && estimate.usage) {
           const percentUsed = (estimate.usage / estimate.quota) * 100;
           setStorageEstimate(percentUsed);
        }
      });
    }
  }, []);

  const steps = useMemo(() => {
    const list: { areaName: string; areaId: string; point: any; index: number; total: number }[] = [];
    site.areas.forEach(area => {
      area.points.forEach(point => {
        list.push({ areaName: area.name, areaId: area.id, point, index: list.length, total: 0 });
      });
    });
    return list.map(item => ({ ...item, total: list.length }));
  }, [site]);

  // STATE INITIALIZATION
  // If draft exists, use its values. Otherwise default.
  const [currentStepIndex, setCurrentStepIndex] = useState(initialDraft ? initialDraft.currentStepIndex : -1);
  const [answers, setAnswers] = useState<Record<string, Answer>>(initialDraft ? initialDraft.answers : {});
  const [inspectorInfo, setInspectorInfo] = useState(initialDraft ? initialDraft.inspectorInfo : {
    name: '',
    dni: '',
    email: ''
  });

  const [selectedStatus, setSelectedStatus] = useState<boolean | null>(null);
  const [tempPhotoPreview, setTempPhotoPreview] = useState<string | null>(null);
  const [tempPhotoRef, setTempPhotoRef] = useState<string | null>(null);
  const [photoUploadStatus, setPhotoUploadStatus] = useState<'none' | 'uploading' | 'done' | 'offline'>('none');
  const [comment, setComment] = useState<string>('');
  const [isCompressing, setIsCompressing] = useState(false);

  const currentStep = currentStepIndex >= 0 ? steps[currentStepIndex] : null;

  // AUTO-SAVE DRAFT EFFECT
  useEffect(() => {
     // Save draft every time we progress or change key data, but only if we have started (index >= 0)
     if (currentStepIndex >= 0 && inspectorInfo.name) {
         const draft: InspectionDraft = {
             siteId: site.id,
             currentStepIndex,
             answers,
             inspectorInfo,
             lastModified: Date.now()
         };
         storageService.saveDraft(draft);
     }
  }, [currentStepIndex, answers, inspectorInfo, site.id]);

  useEffect(() => {
    // Reset local step state when step changes
    setSelectedStatus(null);
    setTempPhotoPreview(null);
    setTempPhotoRef(null);
    setPhotoUploadStatus('none');
    setComment('');
    
    // Check if we already have an answer for this new step (e.g. going back? future feature)
    // For now, we assume linear progression so no need to hydrate current step specific fields
    
    setTimeout(() => {
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = 0;
        }
        window.scrollTo(0, 0);
    }, 50);
  }, [currentStepIndex]);

  const handleStart = () => {
    if (!inspectorInfo.name || !inspectorInfo.dni || !inspectorInfo.email) {
      toast.error('Completa los datos del inspector');
      return;
    }
    setCurrentStepIndex(0);
  };

  const handleNext = async () => {
    if (!currentStep) return;

    if (selectedStatus === null) {
      toast.error('Debes seleccionar SI o NO');
      return;
    }

    if (currentStep.point.requiresPhoto && !tempPhotoRef) {
      toast.error('Foto obligatoria');
      return;
    }

    const answer: Answer = {
      pointId: currentStep.point.id,
      pointName: currentStep.point.name,
      question: currentStep.point.question,
      areaName: currentStep.areaName,
      isOk: selectedStatus,
      photoUrl: tempPhotoRef || undefined, 
      comments: comment.trim() || undefined,
      timestamp: Date.now()
    };

    const newAnswers = { ...answers, [currentStep.point.id]: answer };
    setAnswers(newAnswers);

    if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex(prev => prev + 1);
    } else {
      const log: InspectionLog = {
        id: `insp-${Date.now()}`,
        siteId: site.id,
        siteName: site.name,
        date: new Date().toISOString(),
        inspectorName: inspectorInfo.name,
        inspectorDni: inspectorInfo.dni,
        inspectorEmail: inspectorInfo.email,
        answers: Object.values(newAnswers),
        status: 'completed'
      };
      // Storage service deals with deleting the draft inside saveInspection
      onComplete(log);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && currentStep) {
      setIsCompressing(true);
      setPhotoUploadStatus('none');
      
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
            const rawBase64 = reader.result as string;
            const compressed = await compressImage(rawBase64);
            setTempPhotoPreview(compressed); 

            // Save to IndexedDB (Works for drafts too!)
            const photoId = `${site.id}_${currentStep.point.id}_${Date.now()}`;
            await db.savePhoto(photoId, compressed);
            setTempPhotoRef(`local::${photoId}`); 

            if (navigator.onLine && checkSupabaseConfig()) {
                setPhotoUploadStatus('uploading');
                const cloudPath = `photos/${site.id}/${currentStep.point.id}_${Date.now()}.jpg`;
                
                storageService.uploadPhotoBlob(cloudPath, compressed).then(publicUrl => {
                    if (publicUrl) {
                        setTempPhotoRef(publicUrl); 
                        setPhotoUploadStatus('done');
                    } else {
                        setPhotoUploadStatus('offline');
                    }
                }).catch(() => setPhotoUploadStatus('offline'));
            } else {
                setPhotoUploadStatus('offline');
            }

        } catch(err) {
            toast.error("Error procesando imagen");
            console.error(err);
        } finally {
            setIsCompressing(false);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  if (steps.length === 0) return <div className="p-8 text-center">Sin puntos. <button onClick={onCancel}>Volver</button></div>;

  // --- Login Form (Hydrated if draft exists) ---
  if (currentStepIndex === -1) {
    return (
      <div className="space-y-6 animate-in slide-in-from-right">
        <div className="bg-white p-6 rounded-2xl shadow-lg border border-slate-100">
           <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
             <User className="w-6 h-6 text-safety-600" />
             Datos del Inspector
           </h2>
           <div className="space-y-4">
             <input type="text" value={inspectorInfo.name} onChange={e => setInspectorInfo({...inspectorInfo, name: e.target.value})} className="w-full p-3 bg-slate-50 border rounded-xl" placeholder="Nombre Completo" />
             <input type="text" value={inspectorInfo.dni} onChange={e => setInspectorInfo({...inspectorInfo, dni: e.target.value})} className="w-full p-3 bg-slate-50 border rounded-xl" placeholder="DNI" />
             <input type="email" value={inspectorInfo.email} onChange={e => setInspectorInfo({...inspectorInfo, email: e.target.value})} className="w-full p-3 bg-slate-50 border rounded-xl" placeholder="Email" />
           </div>
           <div className="mt-8 flex gap-3">
             <button onClick={onCancel} className="flex-1 py-3 text-slate-500 font-bold">Cancelar</button>
             <button onClick={handleStart} className="flex-[2] py-3 bg-safety-600 text-white rounded-xl font-bold shadow-lg hover:bg-safety-700">Comenzar</button>
           </div>
        </div>
      </div>
    );
  }

  const progress = ((currentStepIndex + 1) / steps.length) * 100;

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] relative">
      <div className="mb-4 flex justify-between items-end">
         <div className="flex items-center gap-2 text-[10px] text-slate-400">
             <HardDrive className="w-3 h-3" />
             {storageEstimate !== null ? (
                 <span>Disco: {storageEstimate.toFixed(1)}% usado</span>
             ) : (
                 <span>Almacenamiento Local Activo</span>
             )}
         </div>
         <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
           Paso {currentStepIndex + 1}/{steps.length}
         </div>
      </div>
      <div className="h-2 bg-slate-200 rounded-full overflow-hidden mb-4">
          <div className="h-full bg-safety-500 transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto pb-24 no-scrollbar scroll-smooth">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-8">
          <div>
            <div className="text-xl font-bold text-blue-600 mb-1 leading-tight">{currentStep?.areaName}</div>
            <h3 className="text-xl font-bold text-slate-800 mb-2 uppercase leading-tight">{currentStep?.point.name}</h3>
            <h2 className="text-lg font-medium text-slate-500 leading-snug">{currentStep?.point.question}</h2>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button onClick={() => setSelectedStatus(false)} className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${selectedStatus === false ? 'border-red-500 bg-red-50 text-red-600' : 'border-slate-100 bg-white text-slate-400'}`}>
              <div className={`p-2 rounded-full ${selectedStatus === false ? 'bg-red-100' : 'bg-slate-100'}`}><X className="w-6 h-6" /></div>
              <span className="font-bold">NO / Mal</span>
            </button>
            <button onClick={() => setSelectedStatus(true)} className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${selectedStatus === true ? 'border-green-500 bg-green-50 text-green-600' : 'border-slate-100 bg-white text-slate-400'}`}>
              <div className={`p-2 rounded-full ${selectedStatus === true ? 'bg-green-100' : 'bg-slate-100'}`}><Check className="w-6 h-6" /></div>
              <span className="font-bold">SI / Bien</span>
            </button>
          </div>

          <div className="animate-in fade-in">
             <label className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-2"><MessageSquare className="w-4 h-4 text-slate-400" /> Comentarios</label>
             <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Observaciones..." className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-safety-500 outline-none text-sm min-h-[80px]" />
          </div>

          {currentStep?.point.requiresPhoto ? (
            <div className="animate-in fade-in slide-in-from-bottom-2">
              <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-bold text-slate-700">Foto Requerida</label>
                  {tempPhotoRef && (
                      <div className="flex items-center gap-1 text-[10px] font-bold uppercase">
                          {photoUploadStatus === 'uploading' && <span className="text-blue-500 flex items-center gap-1"><Cloud className="w-3 h-3 animate-pulse" /> Subiendo...</span>}
                          {photoUploadStatus === 'done' && <span className="text-green-500 flex items-center gap-1"><Cloud className="w-3 h-3" /> En Nube</span>}
                          {photoUploadStatus === 'offline' && <span className="text-orange-500 flex items-center gap-1"><HardDrive className="w-3 h-3" /> Guardado Local</span>}
                      </div>
                  )}
              </div>
              
              <div className={`border-2 border-dashed rounded-xl overflow-hidden transition-colors ${tempPhotoPreview ? 'border-safety-500' : 'border-slate-300 bg-slate-50'}`}>
                {isCompressing ? (
                    <div className="h-48 flex flex-col items-center justify-center text-slate-400">
                        <div className="w-8 h-8 border-4 border-slate-300 border-t-safety-500 rounded-full animate-spin mb-2"></div>
                        <p className="text-xs">Comprimiendo...</p>
                    </div>
                ) : tempPhotoPreview ? (
                  <div className="relative h-56 bg-black">
                    <img src={tempPhotoPreview} alt="Evidencia" className="w-full h-full object-contain" />
                    <button onClick={() => { setTempPhotoPreview(null); setTempPhotoRef(null); }} className="absolute top-2 right-2 bg-black/50 text-white p-2 rounded-full backdrop-blur-md"><RotateCcw className="w-5 h-5" /></button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center h-48 cursor-pointer active:bg-slate-100">
                    <Camera className="w-10 h-10 text-slate-400 mb-3" />
                    <p className="text-sm font-medium text-slate-600 text-center px-4">{currentStep.point.photoInstruction || 'Toma una foto'}</p>
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoUpload} />
                  </label>
                )}
              </div>
            </div>
          ) : null}
          <div className="h-4"></div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-slate-200 z-10 md:absolute md:rounded-b-2xl">
        <div className="max-w-3xl mx-auto flex gap-3">
          <button onClick={onCancel} className="px-4 py-3 rounded-xl border border-slate-200 text-slate-500 font-bold">Cancelar</button>
          <button 
            onClick={handleNext}
            disabled={selectedStatus === null || isCompressing}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-6 rounded-xl font-bold shadow-lg transition-all ${selectedStatus !== null && !isCompressing ? 'bg-safety-600 text-white shadow-safety-200' : 'bg-slate-100 text-slate-400'}`}
          >
            {currentStepIndex === steps.length - 1 ? 'Finalizar' : 'Siguiente'}
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
