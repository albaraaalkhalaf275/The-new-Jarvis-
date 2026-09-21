interface SpeechRecognitionEvent extends Event { readonly results: SpeechRecognitionResultList }
interface SpeechRecognitionResult { readonly isFinal:boolean; readonly length:number; [index:number]:SpeechRecognitionAlternative }
interface SpeechRecognitionResultList { readonly length:number; [index:number]:SpeechRecognitionResult }
interface SpeechRecognitionAlternative { readonly transcript:string; readonly confidence:number }
interface SpeechRecognitionInstance { lang:string; interimResults:boolean; onresult:((event:SpeechRecognitionEvent)=>void)|null; onend:(()=>void)|null; onerror:(()=>void)|null; start():void; stop():void }
interface SpeechRecognitionConstructor { new():SpeechRecognitionInstance }
interface Window { SpeechRecognition?:SpeechRecognitionConstructor; webkitSpeechRecognition?:SpeechRecognitionConstructor }
