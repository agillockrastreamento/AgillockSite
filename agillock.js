$('document').ready(function(){
	$('.read-more-btn').click(function(){
		var posicaoObjeto= $(this).attr('id')
		if(posicaoObjeto=="1"){
		if($(this).html() == 'Voltar'){
			$('.read-more[id=1]').toggle('medium');
				$(this).html('Leia mais...');
			}
			else{
				$('.read-more[id=1]').toggle('medium');
				$(this).html('Voltar');
			}
		}
		if(posicaoObjeto==2){
				if($(this).html() == 'Voltar'){

			$('.read-more[id=2]').toggle('medium');
				$(this).html('Leia mais...');
			}
			else{
				$('.read-more[id=2]').toggle('medium');
				$(this).html('Voltar');
			}
		}
		if(posicaoObjeto==3){
				if($(this).html() == 'Voltar'){

			$('.read-more[id=3]').toggle('medium');
				$(this).html('Leia mais...');
			}
			else{
				$('.read-more[id=3]').toggle('medium');
				$(this).html('Voltar');
			}
		}
		if(posicaoObjeto==4){
				if($(this).html() == 'Voltar'){

			$('.read-more[id=4]').toggle('medium');
			$(this).html('Leia mais...');
		}
			else{
				$('.read-more[id=4]').toggle('medium');
				$(this).html('Voltar');
			}
		}
	});
	
	$(document).scroll(function(){
		var position = $(this).scrollTop();
		if( /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ) {
			$('.brand > img').attr('style','height:50px;-webkit-transition: height 1s ease-in-out;');
		}
		else{
			//não está no topo
			if(position == 0){
				$('.brand > img').attr('style','height:100px;-webkit-transition: height 1s ease-in-out;');
			}
			else{
				$('.brand > img').attr('style','height:50px;-webkit-transition: height 1s ease-in-out;');
			}
		}
		
	});
	
	
	$(".access-admin").on("click", function() {
		toggleLoading();
	});
});

function toggleLoading() {
	$("#Loading").toggleClass('show');
}