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
  // Converts any URL (local IDB or Cloud URL) to a Base64 string for html2canvas
  const getBase64FromUrl = async (url: string): Promise<string | null> => {
    if (url.startsWith('data:')) return url;
    
    // 1. Resolve Local IndexedDB
    if (url.startsWith('local::')) {
        const id = url.replace('local::', '');
        return await db.getPhoto(id);
    }

    // 2. Resolve Cloud URL (Fetch and Convert)
    try {
        const response = await fetch(url, { mode: 'cors' });
        const blob = await response.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.error("Error fetching cloud image for PDF:", url, e);
        return null;
    }
  };

  useEffect(() => {
    const resolveAll = async () => {
        setIsResolvingImages(true);
        const toastId = toast.loading("Preparando imágenes para el informe...");
        
        try {
            const resolved = await Promise.all(log.answers.map(async (ans) => {
                if (ans.photoUrl) {
                    const b64 = await getBase64FromUrl(ans.photoUrl);
                    return { ...ans, photoUrl: b64 || undefined };
                }
                return ans;
            }));
            setResolvedAnswers(resolved);
            toast.success("Imágenes listas", { id: toastId });
        } catch (e) {
            toast.error("Error al procesar algunas imágenes", { id: toastId });
        } finally {
            setIsResolvingImages(false);
        }
    };
    resolveAll();
  }, [log]);

  // --- PDF PAGINATION LOGIC ---
  // Split answers into chunks to avoid page overflow
  const ITEMS_PER_PAGE = 3; // 3 items with photos is safe for A4
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
      
      for (let i = 0; i < pages.length; i++) {
        const pageElement = pages[i] as HTMLElement;
        if (i > 0) pdf.addPage();

        const canvas = await window.html2canvas(pageElement, {
          scale: 2, // Better quality
          useCORS: true,
          allowTaint: true,
          logging: false,
          windowWidth: 800, // Fixed width for consistent rendering
        });

        const imgData = canvas.toDataURL('image/jpeg', 0.9);
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const imgHeight = (canvas.height * pdfWidth) / canvas.width;
        
        pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, imgHeight);
      }
      return pdf.output('blob');
    } catch (e) {
      console.error("PDF Gen Error:", e);
      return null;
    }
  };

  const handleFinishAndUpload = async () => {
    if (!checkSupabaseConfig()) {
      toast.error("No hay configuración de nube. Guardando solo local.");
      onConfirm();
      return;
    }

    setIsProcessing(true);
    const toastId = toast.loading('Generando documento oficial y subiendo...');

    try {
      const blob = await generatePdfBlob();
      if (!blob) throw new Error("Fallo al generar PDF");

      await storageService.uploadInspectionWithPDF(log, blob);

      toast.success('¡Informe guardado en la nube!', { id: toastId });
      setTimeout(onConfirm, 1000);

    } catch (error: any) {
      console.error(error);
      toast.error(`Error: ${error.message || 'Fallo en subida'}`, { id: toastId });
      setIsProcessing(false);
    }
  };

  const handleDownloadOnly = async () => {
     setIsProcessing(true);
     const toastId = toast.loading('Generando PDF...');
     const blob = await generatePdfBlob();
     if(blob) {
         const url = URL.createObjectURL(blob);
         const a = document.createElement('a');
         a.href = url;
         a.download = `Reporte_${log.siteName.replace(/\s+/g, '_')}_${new Date().toLocaleDateString()}.pdf`;
         a.click();
         toast.success("PDF Descargado", { id: toastId });
     } else {
         toast.error("Error al generar PDF", { id: toastId });
     }
     setIsProcessing(false);
  };

  const ReportHeader = ({ pageNum, totalPages }: { pageNum: number, totalPages: number }) => (
    <div className="border-b-4 border-safety-500 pb-4 mb-6 flex justify-between items-end">
        <div>
            <h1 className="text-xl font-bold text-slate-800 uppercase tracking-tight">Informe de Seguridad Preventiva</h1>
            <p className="text-safety-600 text-xs font-bold">Industrial & Mining Compliance</p>
        </div>
        <div className="text-right text-[10px] text-slate-500 font-medium">
            <p className="font-bold text-slate-800 text-xs uppercase">{log.siteName}</p>
            <p>Página {pageNum} de {totalPages}</p>
        </div>
    </div>
  );

  if (isResolvingImages) {
      return (
          <div className="h-screen flex flex-col items-center justify-center bg-white p-10 text-center">
              <RefreshCw className="w-12 h-12 text-safety-500 animate-spin mb-4" />
              <h2 className="text-xl font-bold text-slate-800">Procesando Informe</h2>
              <p className="text-slate-500 mt-2">Estamos preparando las fotografías y el formato del documento...</p>
          </div>
      );
  }

  return (
    <div className="space-y-6">
      {/* --- UI VISIBLE EN PANTALLA --- */}
      <div className="animate-in fade-in slide-in-from-bottom-4 space-y-6">
        <div className="text-center py-6">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-10 h-10 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800">Control Finalizado</h2>
          <p className="text-slate-500 text-sm mt-1">Se han revisado {log.answers.length} puntos correctamente.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm text-center">
            <div className="text-3xl font-black text-green-600">{passedItems.length}</div>
            <div className="text-[10px] text-slate-400 uppercase font-black tracking-widest">Conformes</div>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm text-center">
            <div className={`text-3xl font-black ${failedItems.length > 0 ? 'text-red-500' : 'text-slate-300'}`}>{failedItems.length}</div>
            <div className="text-[10px] text-slate-400 uppercase font-black tracking-widest">Defectos</div>
          </div>
        </div>

        <div className="fixed bottom-0 left-0 w-full p-4 bg-white/80 backdrop-blur-md border-t border-slate-200 flex flex-col gap-3 pb-8 z-20">
          <button 
            onClick={handleFinishAndUpload}
            disabled={isProcessing}
            className="w-full py-4 px-4 rounded-2xl bg-slate-900 text-white font-bold shadow-xl flex items-center justify-center gap-3 disabled:opacity-70 transition-all active:scale-[0.98]"
          >
            {isProcessing ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Cloud className="w-5 h-5 text-safety-400" />}
            {isProcessing ? 'Generando PDF...' : 'Subir Informe y Finalizar'}
          </button>
          <div className="flex gap-3">
            <button onClick={handleDownloadOnly} disabled={isProcessing} className="flex-1 py-3 px-4 rounded-xl border border-slate-200 bg-white text-slate-700 font-bold hover:bg-slate-50 flex items-center justify-center gap-2 text-sm shadow-sm">
                <FileDown className="w-4 h-4" /> Descargar PDF
            </button>
            <button onClick={onConfirm} className="py-3 px-5 rounded-xl border border-slate-200 bg-white text-slate-400 font-bold hover:text-slate-600 shadow-sm">
                <Home className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="h-32" />
      </div>

      {/* --- PLANTILLA OCULTA PARA PDF (PAGINADA) --- */}
      <div style={{ position: 'fixed', top: 0, left: '-2000px', zIndex: -100 }}>
        <div ref={reportContainerRef} className="bg-slate-100">
          
          {/* PÁGINA 1: PORTADA Y RESUMEN */}
          <div className="pdf-page bg-white p-12 w-[210mm] min-h-[297mm] flex flex-col shadow-none">
             <ReportHeader pageNum={1} totalPages={answerChunks.length + 1} />
             
             <div className="flex justify-between items-start mb-8 mt-4">
                <div className="space-y-4 max-w-[60%]">
                    <div>
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Centro de Trabajo</h3>
                        <p className="text-2xl font-black text-slate-800">{log.siteName}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Fecha / Hora</h3>
                            <p className="text-sm font-bold">{new Date(log.date).toLocaleString()}</p>
                        </div>
                        <div>
                            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Estado Final</h3>
                            <p className={`text-sm font-black ${failedItems.length > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                {failedItems.length > 0 ? '⚠️ CON DEFECTOS' : '✅ APTO'}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-right min-w-[150px]">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Responsable</h3>
                    <p className="text-sm font-bold text-slate-800">{log.inspectorName}</p>
                    <p className="text-[10px] text-slate-400 font-medium">DNI: {log.inspectorDni}</p>
                </div>
             </div>

             <div className="bg-slate-900 rounded-2xl p-6 text-white mb-8">
                <h3 className="text-xs font-black uppercase tracking-widest text-safety-400 mb-4 border-b border-white/10 pb-2">Cuadro de Resultados</h3>
                <div className="grid grid-cols-3 gap-6 text-center">
                    <div>
                        <p className="text-3xl font-black">{log.answers.length}</p>
                        <p className="text-[9px] uppercase tracking-tighter opacity-50">Total Puntos</p>
                    </div>
                    <div>
                        <p className="text-3xl font-black text-green-400">{passedItems.length}</p>
                        <p className="text-[9px] uppercase tracking-tighter opacity-50">Correctos</p>
                    </div>
                    <div>
                        <p className={`text-3xl font-black ${failedItems.length > 0 ? 'text-red-400' : 'opacity-30'}`}>{failedItems.length}</p>
                        <p className="text-[9px] uppercase tracking-tighter opacity-50">Incidencias</p>
                    </div>
                </div>
             </div>

             <div className="mt-auto border-t-2 border-slate-100 pt-10">
                <div className="grid grid-cols-2 gap-20">
                    <div className="text-center">
                        <div className="h-20 border-b border-slate-200 mb-2"></div>
                        <p className="text-[10px] font-black text-slate-400 uppercase">Firma del Inspector</p>
                        <p className="text-xs font-bold text-slate-800">{log.inspectorName}</p>
                    </div>
                    <div className="text-center">
                        <div className="h-20 border-b border-slate-200 mb-2"></div>
                        <p className="text-[10px] font-black text-slate-400 uppercase">Firma Responsable Centro</p>
                        <p className="text-xs font-bold text-slate-800">Recibí conforme</p>
                    </div>
                </div>
             </div>
          </div>

          {/* PÁGINAS 2...N: DETALLE DE PUNTOS (PAGINACIÓN CONTROLADA) */}
          {answerChunks.map((chunk, chunkIdx) => (
             <div key={chunkIdx} className="pdf-page bg-white p-12 w-[210mm] min-h-[297mm] flex flex-col shadow-none">
                <ReportHeader pageNum={chunkIdx + 2} totalPages={answerChunks.length + 1} />
                
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest mb-6 bg-slate-50 p-2 border-l-4 border-safety-500">
                    Detalle de Hallazgos ({chunkIdx + 1} / {answerChunks.length})
                </h3>

                <div className="space-y-6">
                    {chunk.map((ans) => (
                       <div key={ans.pointId} className="flex gap-6 border-b border-slate-100 pb-6 items-start">
                          <div className="flex-1 space-y-2">
                             <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${ans.isOk ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                <h4 className="font-black text-slate-800 text-sm uppercase leading-tight">{ans.pointName}</h4>
                             </div>
                             <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">{ans.areaName}</p>
                             <p className="text-xs text-slate-600 font-medium">{ans.question}</p>
                             
                             <div className="pt-1">
                                <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${ans.isOk ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                    {ans.isOk ? '✓ Conforme' : '✗ No Conforme'}
                                </span>
                             </div>

                             {ans.comments && (
                                <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">Observaciones:</p>
                                    <p className="text-xs text-slate-700 italic">"{ans.comments}"</p>
                                </div>
                             )}
                          </div>

                          {ans.photoUrl && (
                            <div className="w-56 h-40 bg-slate-100 rounded-xl border border-slate-200 overflow-hidden flex-shrink-0 shadow-sm">
                               <img 
                                 src={ans.photoUrl} 
                                 className="w-full h-full object-cover" 
                                 alt="Evidencia" 
                                 onError={(e) => (e.currentTarget.style.display = 'none')}
                               />
                            </div>
                          )}
                       </div>
                    ))}
                </div>
                
                <div className="mt-auto text-center py-4 text-[9px] text-slate-300 font-bold uppercase tracking-widest">
                    Generado por App Controles Preventivos - Documento No Editable
                </div>
             </div>
          ))}
        </div>
      </div>
    </div>
  );
};
