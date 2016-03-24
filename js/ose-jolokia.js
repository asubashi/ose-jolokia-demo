$(function() {
	
    
    
    function buildDashboards(baseUrl, token, jolokiaPods) {
        
        var dashboardDiv = $("#dashboard");
        
        dashboardDiv.empty();
        
        $.each(jolokiaPods, function(key, value) {
            var jolokiaPodUrl = baseUrl + "/https:"+value+":8778/proxy/jolokia/"
            var jolokia = new Jolokia({url: jolokiaPodUrl, token: token});
            
            var podName = value+"-stats"
            
            var podDiv = $('#pod-template').clone(true);
            podDiv.attr("id", podName);
            podDiv.find(".pod-name").text(value);            
            
            dashboardDiv.append(podDiv);
            
            var factory = new JmxChartsFactory(jolokia,podDiv, 100,5000);
            factory.create([
            {
            type: 'read',
            name: 'java.lang:type=Memory',
            attribute: 'HeapMemoryUsage',
            path: 'committed'
            },
            {
            type: 'read',
            name: 'java.lang:type=Memory',
            attribute: 'HeapMemoryUsage',
            path: 'used'
            }
            ]);
            
            
            factory.create(
            {
            type: 'read',
            name: 'java.lang:type=Threading',
            attribute: 'ThreadCount'
            }
            );
            
            factory.create(
            {
            type: 'read',
            name: 'jboss.as:subsystem=web,connector=http',
            attribute: 'requestCount'
            }
            );
            
            
        });
      
        
    }
    
    
    $("#inputForm").submit(
			function(event) {

				event.preventDefault();
                
                var url = $('#url').val();
                var token = $('#token').val();
                var namespace = $('#namespace').val();
                
                var baseUrl = url+"/api/v1/namespaces/"+namespace+"/pods"
				$('input[type="submit"]').attr('disabled','disabled');
				
				$.ajax({
					type: 'GET',
					url: baseUrl,
					success: function(data) { 
                        $('#message').hide();
                        var jolokiaPods = []
                        
                        $.each(data.items, function( key, value ){
                            
                            var podName = value.metadata.name
                                                        
                            if (!podName.match("-build$") && !podName.match("-deploy$") && validateJolokiaPod(value)) {
                                jolokiaPods.push(podName)
                            }
                        });
                        buildDashboards(baseUrl,token,jolokiaPods)
				        $('input[type="submit"]').removeAttr('disabled');
					},
					error: function(data) { 
						$('#message').html('Error occurred during request').show();
				        $('input[type="submit"]').removeAttr('disabled');
					},
					contentType: "application/json",
                    beforeSend: function(xhr, settings) { xhr.setRequestHeader('Authorization','Bearer ' + token); } 
                
				});
			});
            
});

function validateJolokiaPod(podJson) {
    
    var jolokiaFound = false;
    
    $.each(podJson.spec.containers, function(key, value) {
        if(value.ports) {
            $.each(value.ports, function(key, value) {
                if(value.containerPort == "8778") {
                    jolokiaFound = true;
                }
            });
        
        }
    });
    
    return jolokiaFound;
    
}


function JmxChartsFactory(jolokia, container, keepHistorySec, pollInterval, columnsCount) {
    var series = [];
    var monitoredMbeans = [];
    var chartsCount = 0;
    
    // if not given a value for number of columns, use what fits.
    columnsCount = columnsCount || Math.floor($(window).width()/$(container).find(".column").width());

    // poll interval, defaults to 1000ms
    pollInterval = pollInterval || 1000;
    // how many data points to show in the graphs, defaults to 30
    var keepPoints = (keepHistorySec || 30) / (pollInterval / 1000);

    setupPortletsContainer(columnsCount);

    setInterval(function() {
     pollAndUpdateCharts();
    }, pollInterval);

    this.create = function(mbeans) {
     mbeans = $.makeArray(mbeans);
     series = series.concat(createChart(mbeans).series);
     monitoredMbeans = monitoredMbeans.concat(mbeans);
    };

    function pollAndUpdateCharts() {
     var requests = prepareBatchRequest();
     var responses = jolokia.request(requests);
     updateCharts(responses);
    }

    function createNewPortlet(name) {
     return $('#portlet-template')
       .clone(true)
       .appendTo($(container).find('.column')[chartsCount++ % columnsCount])
       .removeAttr('id')
       .find('.title').text((name.length > 50 ? '...' : '') + name.substring(name.length - 50, name.length)).end()
       .find('.portlet-content')[0];
    }

    function setupPortletsContainer() {
     var column = $(container).find('.column');
     for(var i = 1; i < columnsCount; ++i){
      column.clone().appendTo(column.parent());
     }
     $(container).find(".column").sortable({
      connectWith: ".column"
     });

     $(".portlet-header .ui-icon").click(function() {
      $(this).toggleClass("ui-icon-minusthick").toggleClass("ui-icon-plusthick");
      $(this).parents(".portlet:first").find(".portlet-content").toggle();
     });
     $(container).find(".column").disableSelection();
    }

    function prepareBatchRequest() {
     return $.map(monitoredMbeans, function(mbean) {
      switch(mbean.type) {
       case 'read':
        return {
         type: mbean.type,
         opts: mbean.args,
         mbean: mbean.name,
         attribute: mbean.attribute,
         path: mbean.path
        };
        break;
       case 'exec':
        return {
         type: mbean.type,
         arguments: mbean.args,
         mbean: mbean.name,
         operation: mbean.operation,
         path: mbean.path
        };
        break;
      }
     });
    }

    function updateCharts(responses) {
     var curChart = 0;
     $.each(responses, function() {
      var point = {
       x: this.timestamp * 1000,
       y: parseFloat(this.value)
      };
      var curSeries = series[curChart++];
      curSeries.addPoint(point, true, curSeries.data.length >= keepPoints);
     });
    }

    function createChart(mbeans) {
     return new Highcharts.Chart({
      chart: {
       renderTo: createNewPortlet(mbeans[0].name),
       height: 200,
       defaultSeriesType: 'spline',
      },
      title: { text: null },
      xAxis: { type: 'datetime' },
      yAxis: { title: { text: mbeans[0].attribute || mbeans[0].operation } },
      legend: {
       enabled: true,
       borderWidth: 0
      },
      credits: {enabled: false},
      series: $.map(mbeans, function(mbean) {
       return {
        data: [],
        name: mbean.path || mbean.attribute || mbean.args
       }
      })
     })
    }
}