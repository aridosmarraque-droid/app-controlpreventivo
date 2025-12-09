import React, { useEffect, useState } from 'react';
import { Site, InspectionDraft } from '../types';
import { storageService } from '../services/storageService';
import { ChevronRight, MapPin, AlertCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'react-hot-toast';

interface HomeViewProps {
  onSelectSite: (site: Site, draft?: InspectionDraft) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ onSelectSite }) => {
  const [sites, setSites] = useState<Site[]>([]);
  const [draftAlert, setDraftAlert] = useState<{site: Site, draft: InspectionDraft} | null>(null);

  useEffect(() => {
    setSites(storageService.getSites());
    const handleUpdate = () => {
      setSites(storageService.getSites());
    };
    window.addEventListener('sites-updated', handleUpdate);
    return () => window.removeEventListener('sites-updated', handleUpdate);
  }, []);

  const handleSiteClick = (site: Site) => {
      // 1. Check for drafts
      const draft = storageService.getDraft(site.id);
      
      if (draft) {
          // Show alert dialog
          setDraftAlert({ site, draft });
      } else {
          // Normal start
          onSelectSite(site);
      }
  };

  const confirmDraft = (resume: boolean) => {
      if (!draftAlert) return;
      
      if (resume) {
          // Continue
          onSelectSite(draftAlert.site, draftAlert.draft);
      } else {
          // Delete and New
          storageService.deleteDraft(draftAlert.site.id);
          toast.success("Borrador descartado. Iniciando nueva.");
          onSelectSite(draftAlert.site);
      }
      setDraftAlert(null);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 relative">
      <div className="bg-gradient-to-br from-safety-500 to-safety-600 rounded-2xl p-6 text-white shadow-lg">
        <h2 className="text-2xl font-bold mb-2">Iniciar Inspección</h2>
        <p className="opacity-90">Selecciona una instalación para comenzar el control preventivo.</p>
      </div>

      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider ml-1">Instalaciones Disponibles</h3>
      
      <div className="grid gap-4">
        {sites.length === 0 ? (
          <div className="bg-slate-100 rounded-xl p-8 text-center border-2 border-dashed border-slate-300">
            <AlertCircle className="w-10 h-10 text-slate-400 mx-auto mb-3" />
            <p className="text-slate-600 font-medium">No hay instalaciones configuradas.</p>
            <p className="text-sm text-slate-500 mt-1">Ve a Configuración para añadir canteras.</p>
          </div>
        ) : (
          sites.map(site => (
            <button
              key={site.id}
              onClick={() => handleSiteClick(site)}
              className="group bg-white rounded-xl p-5 border border-slate-200 shadow-sm hover:shadow-md hover:border-safety-400 transition-all flex items-center justify-between text-left"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center group-hover:bg-safety-50 transition-colors">
                  <MapPin className="w-5 h-5 text-slate-600 group-hover:text-safety-600" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-800 text-lg">{site.name}</h4>
                  <p className="text-sm text-slate-500">
                    {site.areas.length} Áreas • {site.areas.reduce((acc, a) => acc + a.points.length, 0)} Puntos
                  </p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-safety-500" />
            </button>
          ))
        )}
      </div>

      {/* Draft Alert Dialog */}
      {draftAlert && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
              <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl animate-in zoom-in-95">
                  <div className="flex items-center gap-3 text-orange-600 mb-4">
                      <AlertTriangle className="w-8 h-8" />
                      <h3 className="font-bold text-lg">Inspección Pendiente</h3>
                  </div>
                  <p className="text-slate-600 mb-6 text-sm">
                      Existe una inspección a medias en <strong>{draftAlert.site.name}</strong> iniciada por <strong>{draftAlert.draft.inspectorInfo.name}</strong> el {new Date(draftAlert.draft.lastModified).toLocaleDateString()}.
                      <br/><br/>
                      ¿Deseas continuarla o empezar de cero?
                  </p>
                  <div className="flex flex-col gap-3">
                      <button 
                          onClick={() => confirmDraft(true)}
                          className="w-full py-3 bg-safety-600 text-white rounded-xl font-bold hover:bg-safety-700"
                      >
                          Continuar Inspección
                      </button>
                      <button 
                          onClick={() => confirmDraft(false)}
                          className="w-full py-3 bg-white border border-slate-200 text-slate-500 rounded-xl font-bold hover:bg-slate-50"
                      >
                          Empezar Nueva (Borrar anterior)
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};
