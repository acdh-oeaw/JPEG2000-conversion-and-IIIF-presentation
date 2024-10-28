#!/bin/bash

width=${1:-1920}
height=${2:-1080}
number=${3:-10}
font=${4:-NotoSans 36}
type=${5:-tiff[compression=lzw]}
prefix=${6:-test_}

# Loop to generate TIFF files with numbers 1 to 50
vips black empty_image.v $width $height --bands 3
for i in $(seq 1 $number)
do 
  vips text "number_$i.v" "$i" --dpi 600 --font "$font"
  vips linear empty_image.v empty_white.v 1 255
  vips draw_mask empty_white.v "255 0 0" "number_$i.v" $((200 + ($i * 20 % 200))) $((200 + ($i * 10 % 100)))
  vips copy empty_white.v "$prefix$i.$type"
  rm "number_$i.v"
done
rm empty_white.v
rm empty_image.v
