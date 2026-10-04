



#ifndef __FONTS_H__
#define __FONTS_H__

#include <stdint.h>



typedef struct _tFont
{
  const uint8_t *table;
  const uint8_t *widths;
  uint16_t Width;
  uint16_t Height;
  uint8_t Size;
} sFONT;


extern sFONT Font32;
extern sFONT Font32Medium;
extern sFONT Font28;
extern sFONT Font28Medium;
extern sFONT Font24;
extern sFONT Font24Medium;
extern sFONT Font20;
extern sFONT Font20Medium;
extern sFONT Font18;
extern sFONT Font18Medium;
extern sFONT Font16;
extern sFONT Font16Medium;
extern sFONT Font14;
extern sFONT Font14Medium;
extern sFONT Font12;
extern sFONT Font12Medium;
extern sFONT Font8;
extern sFONT Font8Medium;





#endif // __FONTS_H__
