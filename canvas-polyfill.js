/*
Based on this: http://www.sublimetext.com/~jps/animated_gifs_the_hard_way.html
*/



/*
 Media Fragment URI - Spatial Dimentions polyfill
 http://www.w3.org/TR/media-frags/#naming-space

 It's working in WebKit and Firefox

 WebKit using -webkit-canvas as background.
 Firefox using -moz-image-rect
  
*/

(function($) {

  $.fn.SpatialURIFragPolyFill = function() {
    var cssPattern = /\s*(.*?)\s*\{(.*?)\}/g;
    var bgPattern = /(background(?:-image)*):(.*?);/;

    var uriPattern = /url\((.*?#.*?)\)/g; 
    var spPattern = /(.*?)#xywh=(pixel|percent)*:*(\d+),(\d+),(\d+),(\d+)/;

    var supportBackgroundCanvas = (document.getCSSCanvasContext !== undefined);
    var supportMozImageRect     = !supportBackgroundCanvas;
                                 // don't have a test for that....
    var globaleImageCount = 0;

    var cssCanvas = function(src, name, x, y, w, h, isPercent){
      var img = new Image();
      img.onload = function(){
        if (isPercent){
           var imageWidth = img.width, imageHeight = img.height;

           w = imageWidth * (w*0.01);
           h = imageHeight * (h*0.01);

           x = imageWidth * (x*0.01);
           y = imageHeight * (y*0.01);
        }
        // Delete the canvas before drawing on it!
        document.getCSSCanvasContext("2d", name, 0, 0);
        
        var ctx = document.getCSSCanvasContext("2d", name, w, h);
            ctx.drawImage(img, x,y,w,h,0,0,w,h);
      };
      img.src = src;
    };


    var parseURI = function(URI){
      var frag = spPattern.exec(URI),
          result = "";
      if (frag !== null){

        var src = frag[1],
            isPercent = (frag[2] !== undefined && frag[1].toLowerCase() === "percent"),
            x = parseInt(frag[3],10),
            y = parseInt(frag[4],10),
            w = parseInt(frag[5],10),
            h = parseInt(frag[6],10);

        if (supportBackgroundCanvas){
          var name = "poly_img_"+globaleImageCount;
          cssCanvas(src, name, x, y, w, h, isPercent);
          result = "-webkit-canvas("+name+")";
          globaleImageCount++;
        }else if(supportMozImageRect){
          var bottom = y + h,
              right = x + w,
              unit = isPercent ? "%" : "";
          result = "-moz-image-rect(url("+src+"),"+y+unit+","+right+unit+","+bottom+unit+","+x+unit+")";
        }
      }
      return [result, x, y, w, h, isPercent];
    };


    var parse = function(css){
       var updatedCSS = "", matches, uri;
       css = css.replace(/\s*(?!<\")\/\*[^\*]+\*\/(?!\")\s*/gm, '').replace(/ |\n|\r/g, '');


       while ((matches = cssPattern.exec(css)) !== null){
         var selector = matches[1];
         var rule = matches[2];
         if (rule !== ""){
           var bgMatch =  bgPattern.exec(rule);
           if (bgMatch !== null){
             var bgProp = bgMatch[1];
             var bg = bgMatch[2];
             var modBg = bg;
             while ((uri = uriPattern.exec(bg)) !== null){
               modBg = modBg.replace(uri[0], parseURI(uri[1])[0]);
             }
             updatedCSS += selector+"{"+bgProp+":"+modBg+" !important;}";
           }
          }
        }
       $('<style>' + updatedCSS + '</style>').appendTo('head');
    };

    // Update CSS
    $('style').each(function() {
        if ($(this).is('link')) $.get(this.href).success(function(css) { parse(css); }); else parse($(this).text());
    });

    // Update IMG-Tag
    $('img').each(function(){
      var $this = $(this);
      var uri = this.src;
      var parsedURI = parseURI(uri);
      if (parsedURI !== null){
      var unit = parsedURI[5] ? "%" : "px";

      $this.attr("style", "display:block;background-image:"+parsedURI[0]+";width:"+parsedURI[3]+unit+";height:"+parsedURI[4]+unit+";");
      this.src = "";
        }
    });


  };
})(jQuery);

$.fn.SpatialURIFragPolyFill();
 
