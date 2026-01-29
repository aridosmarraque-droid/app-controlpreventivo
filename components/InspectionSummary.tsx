import React, { useRef, useState, useEffect } from 'react';
import { InspectionLog, Answer } from '../types';
import { CheckCircle, AlertTriangle, Upload, FileDown, Home, ListChecks, Cloud, RefreshCw } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { storageService } from '../services/storageService';
import { checkSupabaseConfig } from '../services/supabaseClient';
import { db } from '../services/db';

declare global {
  interface Window {
    jspdf: any;
    html2canvas: any;
  }
}

interface Props {
  log: InspectionLog;
  onConfirm: () => void;
  onBack: () => void;
}

export const InspectionSummary: React.FC<Props> = ({ log, onConfirm, onBack }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [resolvedAnswers, setResolvedAnswers] = useState<Answer[]>([]);
  const [isResolvingImages, setIsResolvingImages] = useState(true);
  const reportContainerRef = useRef<HTMLDivElement>(null);

  const failedItems = log.answers.filter(a => !a.isOk);
  const passedItems = log.answers.filter(a => a.isOk);

  // --- IMAGE RESOLUTION LOGIC ---
  const getBase64FromUrl = async (url: string): Promise<string | null> => {
    if (url.startsWith('data:')) return url;
    
    // 1. Resolve Local IndexedDB
    if (url.startsWith('local::')) {
        const id = url.replace('local::', '');
        return await db.getPhoto(id);
    }

    // 2. Resolve Cloud URL (Fetch and Convert)
    try {
        // We add a timestamp to bypass cache which often causes CORS issues in some browsers
        const proxyUrl = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
        const response = await fetch(proxyUrl, { mode: 'cors', cache: 'no-cache' });
        if (!response.ok) throw new Error("Net error");
        const blob = await response.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.error("Error fetching cloud image for PDF:", url, e);
        // Fallback: try to see if we still have it in local DB just in case
        const localId = url.split('/').pop()?.split('.')[0];
        if (localId) {
            const fallback = await db.getPhoto(localId);
            if (fallback) return fallback;
        }
        return null;
    }
  };

  useEffect(() => {
    const resolveAll = async () => {
        setIsResolvingImages(true);
        const toastId = toast.loading("Preparando imágenes y formato...");
        
        try {
            const resolved = await Promise.all(log.answers.map(async (ans) => {
                if (ans.photoUrl) {
                    const b64 = await getBase64FromUrl(ans.photoUrl);
                    return { ...ans, photoUrl: b64 || undefined };
                }
                return ans;
            }));
            setResolvedAnswers(resolved);
            toast.success("Informe listo", { id: toastId });
        } catch (e) {
            toast.error("Error al procesar imágenes", { id: toastId });
        } finally {
            setIsResolvingImages(false);
        }
    };
    resolveAll();
  }, [log]);

  // --- PDF PAGINATION LOGIC ---
  const ITEMS_PER_PAGE = 3; 
  const answerChunks = [];
  for (let i = 0; i < resolvedAnswers.length; i += ITEMS_PER_PAGE) {
      answerChunks.push(resolvedAnswers.slice(i, i + ITEMS_PER_PAGE));
  }

  const generatePdfBlob = async (): Promise<Blob | null> => {
    if (!reportContainerRef.current || !window.jspdf || !window.html2canvas) {
      toast.error('Librerías PDF no cargadas.');
      return null;
    }

    try {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pages = reportContainerRef.current.querySelectorAll('.pdf-page');
      
      // We give the browser a tiny moment to ensure the hidden DOM is painted
      await new Promise(r => setTimeout(r, 500));

      for (let i = 0; i < pages.length; i++) {
        const pageElement = pages[i] as HTMLElement;
        if (i > 0) pdf.addPage();

        const canvas = await window.html2canvas(pageElement, {
          scale: 2,
          useCORS: true,
          allowTaint: false, // Changed to false to avoid security exceptions
          logging: false,
          backgroundColor: '#ffffff',
          windowWidth: 1000, // Slightly wider for better internal scaling
        });

        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        
        // Fit to page
        pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
      }
      return pdf.output('blob');
    } catch (e) {
      console.error("PDF Gen Error:", e);
      return null;
    }
  };

  const handleFinishAndUpload = async () => {
    if (!checkSupabaseConfig()) {
      toast.error("No hay configuración de nube.");
      onConfirm();
      return;
    }

    setIsProcessing(true);
    const toastId = toast.loading('Firmando y subiendo reporte oficial...');

    try {
      const blob = await generatePdfBlob();
      if (!blob) throw new Error("Fallo al generar PDF");

      await storageService.uploadInspectionWithPDF(log, blob);

      toast.success('¡Informe subido correctamente!', { id: toastId });
      setTimeout(onConfirm, 1000);

    } catch (error: any) {
      console.error(error);
      toast.error(`Error: ${error.message || 'Fallo en subida'}`, { id: toastId });
      setIsProcessing(false);
    }
  };

  const handleDownloadOnly = async () => {
     setIsProcessing(true);
     const toastId = toast.loading('Generando archivo...');
     const blob = await generatePdfBlob();
     if(blob) {
         const url = URL.createObjectURL(blob);
         const a = document.createElement('a');
         a.href = url;
         a.download = `Reporte_${log.siteName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
         a.click();
         toast.success("PDF descargado", { id: toastId });
     } else {
         toast.error("Error al generar PDF", { id: toastId });
     }
     setIsProcessing(false);
  };

  const ReportHeader = ({ pageNum, totalPages }: { pageNum: number, totalPages: number }) => (
    <div className="border-b-4 border-safety-500 pb-4 mb-8 flex justify-between items-end">
        <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-safety-500 rounded flex items-center justify-center">
                <CheckCircle className="text-white w-6 h-6" />
            </div>
            <div>
                <h1 className="text-lg font-black text-slate-800 uppercase leading-none">Control Preventivo</h1>
                <p className="text-safety-600 text-[10px] font-bold uppercase tracking-widest mt-1">Seguridad & Salud Laboral</p>
            </div>
        </div>
        <div className="text-right">
            <p className="font-black text-slate-900 text-xs uppercase">{log.siteName}</p>
            <p className="text-[9px] text-slate-400 font-bold">PÁGINA {pageNum} / {totalPages}</p>
        </div>
    </div>
  );

  if (isResolvingImages) {
      return (
          <div className="h-screen flex flex-col items-center justify-center bg-white p-10 text-center">
              <RefreshCw className="w-12 h-12 text-safety-500 animate-spin mb-4" />
              <h2 className="text-xl font-bold text-slate-800">Finalizando Inspección</h2>
              <p className="text-slate-500 mt-2">Estamos procesando las evidencias fotográficas...</p>
          </div>
      );
  }

  return (
    <div className="space-y-6">
      {/* UI SCREEN */}
      <div className="animate-in fade-in slide-in-from-bottom-4 space-y-6 pb-32">
        <div className="text-center py-6">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-green-50 shadow-inner">
            <CheckCircle className="w-10 h-10 text-green-600" />
          </div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">Inspección Finalizada</h2>
          <p className="text-slate-500 text-sm mt-1">{log.siteName} • {new Date(log.date).toLocaleDateString()}</p>
        </div>

        <div className="grid grid-cols-2 gap-4 px-2">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm text-center">
            <div className="text-4xl font-black text-green-600 leading-none mb-1">{passedItems.length}</div>
            <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">Puntos OK</div>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm text-center">
            <div className={`text-4xl font-black leading-none mb-1 ${failedItems.length > 0 ? 'text-red-500' : 'text-slate-200'}`}>{failedItems.length}</div>
            <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">Defectos</div>
          </div>
        </div>

        {failedItems.length > 0 && (
            <div className="bg-red-50 border border-red-100 rounded-2xl p-4 mx-2">
                <h4 className="text-red-800 font-bold text-sm flex items-center gap-2 mb-2 uppercase">
                    <AlertTriangle className="w-4 h-4" /> Resumen de Defectos
                </h4>
                <ul className="space-y-1">
                    {failedItems.slice(0, 3).map(f => (
                        <li key={f.pointId} className="text-xs text-red-600 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-red-400 rounded-full"></span>
                            {f.pointName}
                        </li>
                    ))}
                    {failedItems.length > 3 && <li className="text-[10px] text-red-400 font-bold ml-4">Y {failedItems.length - 3} puntos más...</li>}
                </ul>
            </div>
        )}

        <div className="fixed bottom-0 left-0 w-full p-4 bg-white/90 backdrop-blur-md border-t border-slate-200 flex flex-col gap-3 pb-10 z-30">
          <button 
            onClick={handleFinishAndUpload}
            disabled={isProcessing}
            className="w-full py-4 px-4 rounded-2xl bg-slate-900 text-white font-bold shadow-xl flex items-center justify-center gap-3 disabled:opacity-70 transition-all active:scale-[0.98]"
          >
            {isProcessing ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Cloud className="w-5 h-5 text-safety-400" />}
            {isProcessing ? 'Subiendo...' : 'Firmar y Subir Informe'}
          </button>
          <div className="flex gap-3">
            <button onClick={handleDownloadOnly} disabled={isProcessing} className="flex-1 py-3 px-4 rounded-xl border border-slate-200 bg-white text-slate-700 font-bold flex items-center justify-center gap-2 text-sm">
                <FileDown className="w-4 h-4" /> Descargar PDF
            </button>
            <button onClick={onConfirm} className="py-3 px-5 rounded-xl border border-slate-200 bg-white text-slate-400 font-bold">
                <Home className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* HIDDEN PDF TEMPLATE */}
      <div style={{ position: 'fixed', top: 0, left: '-2500px', zIndex: -100 }}>
        <div ref={reportContainerRef} className="bg-slate-50">
          
          {/* PAGE 1: COVER */}
          <div className="pdf-page bg-white p-16 w-[210mm] min-h-[297mm] flex flex-col shadow-none box-border border-[10mm] border-transparent">
             <ReportHeader pageNum={1} totalPages={answerChunks.length + 1} />
             
             <div className="mt-10 mb-12">
                <p className="text-[10px] font-black text-safety-600 uppercase tracking-[0.2em] mb-4">Registro de Inspección de Seguridad</p>
                <h2 className="text-5xl font-black text-slate-900 leading-tight mb-2">{log.siteName}</h2>
                <div className="h-2 w-24 bg-safety-500 rounded-full"></div>
             </div>

             <div className="grid grid-cols-2 gap-12 mb-16">
                <div className="space-y-6">
                    <div>
                        <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Fecha de Emisión</h3>
                        <p className="text-base font-bold text-slate-800">{new Date(log.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                    <div>
                        <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Resultado General</h3>
                        <p className={`text-base font-black uppercase ${failedItems.length > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {failedItems.length > 0 ? 'Requiere Acciones Correctivas' : 'Instalación Conforme'}
                        </p>
                    </div>
                </div>
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                    <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4 border-b border-slate-200 pb-2 text-center">Inspector Responsable</h3>
                    <p className="text-lg font-black text-slate-800 text-center">{log.inspectorName}</p>
                    <p className="text-xs text-slate-500 text-center mt-1">ID / DNI: {log.inspectorDni}</p>
                    <p className="text-xs text-slate-500 text-center italic mt-4 opacity-50 underline">{log.inspectorEmail}</p>
                </div>
             </div>

             <div className="bg-slate-900 rounded-3xl p-8 text-white mb-auto shadow-lg">
                <div className="grid grid-cols-3 gap-8 text-center divide-x divide-white/10">
                    <div>
                        <p className="text-4xl font-black mb-1">{log.answers.length}</p>
                        <p className="text-[8px] font-black uppercase tracking-widest opacity-40">Verificados</p>
                    </div>
                    <div>
                        <p className="text-4xl font-black text-green-400 mb-1">{passedItems.length}</p>
                        <p className="text-[8px] font-black uppercase tracking-widest opacity-40">Sin Hallazgos</p>
                    </div>
                    <div>
                        <p className={`text-4xl font-black mb-1 ${failedItems.length > 0 ? 'text-red-400' : 'opacity-20'}`}>{failedItems.length}</p>
                        <p className="text-[8px] font-black uppercase tracking-widest opacity-40">No Conformidades</p>
                    </div>
                </div>
             </div>

             <div className="mt-20 flex gap-12 pt-10">
                <div className="flex-1 text-center">
                    <div className="h-24 border-b-2 border-slate-100 flex items-center justify-center italic text-slate-300 text-xs">Firma Digital Registrada</div>
                    <p className="text-[9px] font-black text-slate-400 uppercase mt-4">Inspector de Seguridad</p>
                </div>
                <div className="flex-1 text-center">
                    <div className="h-24 border-b-2 border-slate-100"></div>
                    <p className="text-[9px] font-black text-slate-400 uppercase mt-4">Responsable de Planta</p>
                </div>
             </div>
          </div>

          {/* PAGES 2+ DETAILED LOGS */}
          {answerChunks.map((chunk, chunkIdx) => (
             <div key={chunkIdx} className="pdf-page bg-white p-16 w-[210mm] min-h-[297mm] flex flex-col shadow-none box-border border-[10mm] border-transparent">
                <ReportHeader pageNum={chunkIdx + 2} totalPages={answerChunks.length + 1} />
                
                <h3 className="text-[10px] font-black text-slate-900 uppercase tracking-widest mb-8 flex items-center gap-3">
                    <span className="bg-slate-900 text-white w-5 h-5 flex items-center justify-center rounded text-[8px]">{chunkIdx + 1}</span>
                    Detalle de Hallazgos y Evidencias
                </h3>

                <div className="flex-1">
                    <div className="space-y-10">
                        {chunk.map((ans) => (
                           <div key={ans.pointId} className="flex gap-8 border-b border-slate-50 pb-8 last:border-0 items-start">
                              <div className="flex-1 space-y-3">
                                 <div className="flex items-center gap-3">
                                    <div className={`w-3 h-3 rounded-full ${ans.isOk ? 'bg-green-500' : 'bg-red-500'} ring-4 ${ans.isOk ? 'ring-green-50' : 'ring-red-50'}`}></div>
                                    <h4 className="font-black text-slate-900 text-base uppercase leading-none tracking-tight">{ans.pointName}</h4>
                                 </div>
                                 <p className="text-[9px] text-slate-400 font-bold uppercase ml-6 tracking-wide">{ans.areaName}</p>
                                 <p className="text-sm text-slate-600 font-medium ml-6 leading-relaxed italic border-l-2 border-slate-100 pl-3">¿{ans.question}?</p>
                                 
                                 <div className="ml-6 flex items-center gap-4">
                                    <span className={`px-2 py-1 rounded text-[8px] font-black uppercase ${ans.isOk ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                        {ans.isOk ? '✓ CUMPLE' : '✗ NO CUMPLE'}
                                    </span>
                                 </div>

                                 {ans.comments && (
                                    <div className="ml-6 bg-slate-50 p-3 rounded-xl border border-slate-100">
                                        <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Observaciones Técnicas:</p>
                                        <p className="text-xs text-slate-700 font-medium">"{ans.comments}"</p>
                                    </div>
                                 )}
                              </div>

                              {ans.photoUrl && (
                                <div className="w-64 h-48 bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden flex-shrink-0 shadow-sm">
                                   <img 
                                     src={ans.photoUrl} 
                                     crossOrigin="anonymous"
                                     className="w-full h-full object-cover" 
                                     alt="Foto" 
                                   />
                                </div>
                              )}
                           </div>
                        ))}
                    </div>
                </div>
                
                <div className="mt-10 pt-6 border-t border-slate-50 flex justify-between items-center text-[8px] text-slate-300 font-bold uppercase tracking-widest">
                    <span>Certificado de Inspección No: {log.id}</span>
                    <span>Software de Cumplimiento Normativo Industrial</span>
                </div>
             </div>
          ))}
        </div>
      </div>
    </div>
  );
};
