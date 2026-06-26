import { motion } from "framer-motion";

export function FullScreenLoader() {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm z-[100]">
      <motion.div
        className="relative w-16 h-16"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        <motion.span
          className="absolute inset-0 block rounded-full border-4 border-primary/20"
        ></motion.span>
        <motion.span
          className="absolute inset-0 block rounded-full border-4 border-primary border-t-transparent"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, ease: "linear", repeat: Infinity }}
        ></motion.span>
      </motion.div>
      <motion.p
        className="mt-6 text-sm font-medium text-muted-foreground animate-pulse"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        جاري التحميل...
      </motion.p>
    </div>
  );
}

export function PageFallback() {
  return (
    <div className="fixed top-0 left-0 right-0 z-[100] h-1 pointer-events-none bg-primary/10 overflow-hidden">
      <motion.div
        className="h-full bg-primary"
        initial={{ x: "-100%" }}
        animate={{
          x: ["-100%", "100%"],
        }}
        transition={{
          duration: 1.5,
          ease: "easeInOut",
          repeat: Infinity,
        }}
      />
    </div>
  );
}
