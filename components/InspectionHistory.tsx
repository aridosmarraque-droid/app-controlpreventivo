import React, { useEffect, useState } from 'react';
import { InspectionLog } from '../types';
import { storageService } from '../services/storageService';
import { Calendar, User, FileText, CheckCircle, AlertTriangle, ArrowRight, Cloud, CloudOff, FileDown } from 'lucide-react';

interface Props {
  onViewReport: (log: InspectionLog) => void;
}

export const InspectionHistory: React.FC<Props> = ({ onViewReport }) => {
  const [logs, setLogs] = useState<InspectionLog[]>([]);

  useEffect(() => {
    // Sort by newest first
    const updateLogs = () => {
        const data = storageService.getInspections().sort((a, b) => 
            new Date(b.date).getTime() - new Date(a.date).getTime()
        );
        setLogs(data);
    };

    updateLogs();

    window.addEventListener('inspections-updated', updateLogs);
    return () => window.removeEventListener('inspections-updated', updateLogs);
  }, []);

  return (
    <div className="space-y-6 animate-in fade-in">
      <h2 className="text-2xl font-bold text-slate-800 mb-4 flex items-center gap-2">
        <FileText className="w-6 h-6 text-safety-600" />
        Historial de Inspecciones
      </h2>

      {logs.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-slate-100">
           <p className="text-slate-400">No hay inspecciones registradas aún.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map(log => {
             const defects = log.answers.filter(a => !a.isOk).length;
             return (
               <div 
                 key={log.id}
                 className="w-full bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-safety-400 transition-all text-left group"
               >
                 <div className="flex justify-between items-start mb-2">
                   <div>
                     <h3 className="font-bold text-slate-800 flex items-center gap-2">
                         {log.siteName}
                         {log.synced ? 
                            <Cloud className="w-4 h-4 text-blue-400" /> : 
                            <CloudOff className="w-4 h-4 text-orange-400" />
                         }
                     </h3>
                     <div className="flex items-center text-xs text-slate-500 gap-3 mt-1">
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3"/> {new Date(log.date).toLocaleDateString()}</span>
                        <span className="flex items-center gap-1"><User className="w-3 h-3"/> {log.inspectorName}</span>
                     </div>
                   </div>
                   <div className={`px-2 py-1 rounded text-xs font-bold ${defects === 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {defects === 0 ? 'OK' : `${defects} DEFECTOS`}
                   </div>
                 </div>
                 
                 <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
                    <button 
                        onClick={() => onViewReport(log)}
                        className="flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold text-slate-500 bg-slate-50 rounded hover:bg-slate-100"
                    >
                        Ver Detalle <ArrowRight className="w-3 h-3" />
                    </button>
                    
                    {log.pdfUrl && (
                        <a 
                            href={log.pdfUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold text-white bg-slate-800 rounded hover:bg-slate-700"
                        >
                            Ver PDF Nube <FileDown className="w-3 h-3" />
                        </a>
                    )}
                 </div>
               </div>
             );
          })}
        </div>
      )}
    </div>
  );
};
