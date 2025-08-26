!macro preInit
  ExecWait 'taskkill /F /IM "${APP_PRODUCT_FILENAME}.exe"'
!macroend