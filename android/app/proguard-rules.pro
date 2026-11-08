# The desktop server is started by class name through app_process, so its entry point has to keep its name.
-keep class com.wonderhoylabs.asahi.server.Main {
    public static void main(java.lang.String[]);
}
