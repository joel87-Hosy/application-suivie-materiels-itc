/* Speech input uses the same command dispatcher as typed input. */
(function(global) {
  class VoiceAssistant {
    constructor(options) { this.options=options;this.host=options.host;this.enabled=false;this.recognition=null;this.turn=0;this.speech=null;this.finishTimer=null; }
    state(name,message) { this.options.onState(name,message); }
    clearTimer() { if(this.finishTimer!==null)(this.options.clearTimeout || clearTimeout)(this.finishTimer);this.finishTimer=null; }
    stop() {
      this.clearTimer();
      this.turn++;this.enabled=false;
      const recognition=this.recognition;this.recognition=null;
      if(recognition) { recognition.onend=recognition.onresult=recognition.onerror=null;try{recognition.abort()}catch(_){} this.options.setInput(this.draft || ''); }
      this.speech=null;this.host.speechSynthesis?.cancel();
      this.state('idle','Mode vocal arrêté.');
    }
    start() {
      if(this.recognition) {this.stop();return;}
      if(this.options.isBusy()) {this.state('processing','Une demande est en cours. Attendez la réponse.');return;}
      const Recognition=this.host.SpeechRecognition || this.host.webkitSpeechRecognition;
      if(!Recognition) {this.options.onError('La reconnaissance vocale n’est pas disponible dans ce navigateur. Vous pouvez continuer par écrit.');return;}
      if(this.host.isSecureContext===false) {this.options.onError('Le microphone nécessite une connexion HTTPS (ou un accès local). Vous pouvez continuer par écrit.');return;}
      this.stop();this.enabled=true;
      const token=++this.turn,session=this.options.session();
      this.draft=this.options.getInput();
      let finalText='',heardText='',hasInterim=false,uncertain=false;
      const valid=()=>token===this.turn && session===this.options.session();
      let recognition;
      try {recognition=new Recognition();} catch(_) {this.stop();this.options.onError('Impossible de démarrer le microphone. Réessayez ou écrivez votre demande.');return;}
      this.recognition=recognition;
      recognition.lang='fr-FR';recognition.continuous=true;recognition.interimResults=true;recognition.maxAlternatives=3;
      const finish=()=>{
        if(!valid()){if(this.recognition===recognition)this.stop();return;}
        this.clearTimer();this.recognition=null;this.turn++;
        recognition.onend=recognition.onresult=recognition.onerror=null;
        try{recognition.abort()}catch(_){}
        if(this.options.isBusy() || !heardText) {
          this.options.setInput(this.draft || '');
          this.state('idle','Aucune commande envoyée. Appuyez sur le microphone pour réessayer.');return;
        }
        if(hasInterim || !finalText || uncertain || /\b(de|du|des|le|la|les|en|pour|avec|au|aux|et)\s*[.?!]*$/i.test(finalText)) {
          this.options.setInput(heardText);
          this.state('review','Transcription incertaine ou incomplète : relisez et corrigez le texte, puis cliquez sur « Vérifier et envoyer », ou répétez au micro.');return;
        }
        this.options.setInput(finalText);
        this.state('processing','Demande reçue. Traitement en cours…');
        Promise.resolve(this.options.onSubmit()).catch(()=>{this.state('idle','Demande interrompue. Réessayez.');});
      };
      const scheduleFinish=()=>{
        this.clearTimer();
        if(!valid() || !heardText)return;
        // Stable final results need only a short pause; partial results get more time and are never auto-submitted.
        this.finishTimer=(this.options.setTimeout || setTimeout)(finish,hasInterim?2500:800);
      };
      this.state('listening','Autorisez le microphone puis parlez. Une pause termine votre demande.');
      recognition.onstart=()=>{if(valid())this.state('listening','Je vous écoute… Une pause termine votre demande.');};
      recognition.onspeechstart=()=>{if(valid()){this.clearTimer();hasInterim=true;}};
      recognition.onspeechend=()=>{if(valid())scheduleFinish();};
      recognition.onresult=event=>{
        if(!valid())return;
        const results=Array.from(event.results);
        const normalizeCommand=text=>text.replace(/\bp[\s.-]*d[\s.-]*f\b/gi,'PDF').replace(/\bx[\s.-]*l[\s.-]*s[\s.-]*x\b/gi,'XLSX').replace(/\bi[\s.-]*t[\s.-]*c\s*[- ]?b\s*0\s*([12])\b/gi,'ITC-B0$1').trim();
        finalText=normalizeCommand(results.filter(r=>r.isFinal).map(r=>r[0].transcript).join(' '));
        heardText=normalizeCommand(results.map(r=>r[0].transcript).join(' '));
        hasInterim=results.some(r=>!r.isFinal && r[0].transcript.trim());
        const key=text=>String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
        uncertain=results.filter(r=>r.isFinal).some(r=>{
          const top=r[0],score=top.confidence;
          if(typeof score!=='number' || !Number.isFinite(score) || score<0 || score>1)return false;
          return score<0.65 || Array.from(r).slice(1).some(alt=>typeof alt.confidence==='number' && alt.confidence>0 && score-alt.confidence<0.12 && key(alt.transcript)!==key(top.transcript));
        });
        this.options.setInput(heardText);
        scheduleFinish();
      };
      recognition.onerror=event=>{
        if(!valid())return;
        this.stop();
        const messages={'not-allowed':'Microphone refusé. Autorisez le microphone dans votre navigateur, puis réessayez.','service-not-allowed':'Le service de reconnaissance vocale est indisponible ou interdit. Continuez par écrit.','audio-capture':'Aucun microphone utilisable. Vérifiez son branchement et ses autorisations.','no-speech':'Aucune parole reconnue. Appuyez sur le microphone pour réessayer.','network':'La reconnaissance vocale a rencontré une erreur réseau. Réessayez ou continuez par écrit.'};
        this.options.onError(messages[event.error] || 'La reconnaissance a été interrompue. Aucune commande n’a été envoyée.');
      };
      recognition.onend=finish;
      try {recognition.start();} catch(_) {this.stop();this.options.onError('Impossible de démarrer le microphone. Vérifiez son accès puis réessayez.');}
    }
    speak(text) {
      if(!this.enabled || this.recognition)return;
      const synth=this.host.speechSynthesis,Utterance=this.host.SpeechSynthesisUtterance;
      if(!synth || !Utterance) {this.state('idle','Réponse affichée. La lecture vocale n’est pas disponible.');return;}
      const plain=String(text || '').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*#`]/g,'').trim();
      if(!plain)return;
      synth.cancel();
      const utterance=new Utterance(plain);this.speech=utterance;
      utterance.lang='fr-FR';utterance.rate=1;
      const voice=synth.getVoices().find(v=>v.lang?.startsWith('fr'));if(voice)utterance.voice=voice;
      const session=this.options.session();
      const finish=message=>{if(this.speech!==utterance)return;this.speech=null;if(session!==this.options.session()){this.stop();return;}this.state('idle',message);};
      utterance.onend=()=>finish('À vous : appuyez sur le microphone pour une autre demande.');
      utterance.onerror=()=>finish('Réponse affichée. La lecture vocale a été interrompue.');
      this.state('speaking','L’agent IA vous répond…');
      try{synth.speak(utterance)}catch(_){finish('Réponse affichée. La lecture vocale n’a pas pu démarrer.');}
    }
  }
  if(typeof module!=='undefined'&&module.exports)module.exports=VoiceAssistant;else global.VoiceAssistant=VoiceAssistant;
})(typeof window==='undefined'?globalThis:window);
